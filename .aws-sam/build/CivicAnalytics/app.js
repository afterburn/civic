const AWS = require("aws-sdk");
AWS.config.update({ region: process.env.AWS_REGION });
const docClient = new AWS.DynamoDB.DocumentClient();
const kms = new AWS.KMS({ region: process.env.AWS_REGION });

async function decryptValue (input) {
  const { Plaintext } = await kms.decrypt({
    CiphertextBlob: Buffer.from(input, "base64"),
  }).promise();
  return Plaintext.toString();
}

async function decrypt (payload) {
  const decrypted = await Promise.all([
    decryptValue(payload.username),
    decryptValue(payload.full_name),
    decryptValue(payload.date_of_birth),
    decryptValue(payload.address),
    decryptValue(payload.phone_number),
  ]);
  return {
    username: decrypted[0],
    full_name: decrypted[1],
    date_of_birth: decrypted[2],
    address: decrypted[3],
    phone_number: decrypted[4],
  }
}

exports.handler = async (event) => {
  switch (event["detail-type"]) {
    case "ValidationRequest": {
      console.log("ValidationRequest:", event.detail.payload.id);
      break;
    }
    case "ValidationResult":
    case "DataStored": {
      try {
        const dbResult = await Promise.allSettled([
          docClient.get({
            TableName: "decisions",
            Key: {
              id: event.detail.payload.id
            }
          }).promise(),
          docClient.get({
            TableName: "pii",
            Key: {
              id: event.detail.payload.id
            }
          }).promise()
        ]);
        console.log("DBGet:", dbResult);

        if (dbResult.map(entry => entry.status).every(status => status === "fulfilled")) {
          const decisionData = dbResult[0].value.Item;
          const piiData = dbResult[1].value.Item;
          const piiDataDecrypted = await decrypt(piiData);
          console.log("Push onto analytics pipeline:", event.detail.payload.id, decisionData, piiDataDecrypted);
        } else {
          console.log("DBGet failed:", dbResult);
        }
      } catch(ex) {
        console.log(ex)
      }
      console.log("DataStored:", event.detail.payload.id);
      break;
    }
    case "DeletionRequest": {
      console.log("DeletionRequest:", event.detail.payload.id);
      break;
    }
    default: {
      console.log(`Received unknown event: "${event["detail-type"]}".`);
      console.log(event.detail);
      break;
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      payload: null
    })
  }
}