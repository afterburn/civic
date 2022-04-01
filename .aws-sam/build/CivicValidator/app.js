const AWS = require("aws-sdk");
AWS.config.update({ region: process.env.AWS_REGION });
const eb = new AWS.EventBridge();
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

function calculateAge(dateString) {
  const today = new Date();
  const birthDate = new Date(dateString);
  const m = today.getMonth() - birthDate.getMonth();
  let age = today.getFullYear() - birthDate.getFullYear();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
      age--;
  }
  return age;
}

exports.handler = async (event) => {
  switch (event["detail-type"]) {
    case "DeletionRequest": {
      console.log("DeletionRequest:", event.detail.payload);
      const id = event.detail.payload.id;
      const dbResult = await docClient.delete({
        TableName: "decisions",
        Key: {
          id
        }
      }).promise();
      console.log("DBDelete:", dbResult);
      break;
    }
    case "ValidationRequest": {
      console.log("ValidationRequest:", event.detail.payload);
      const id = event.detail.payload.id;
      const validation_request = await decrypt(event.detail.payload);
      console.log("ValidationRequest (decrypted):", validation_request);

      // Insert decision data into low security data store.
      try {
        const now = new Date();
        const result = await docClient.put({
          TableName: "decisions",
          Item: {
            id: id,
            status: 0,
            decision: 0,
            created: now.toISOString(),
            updated: now.toISOString()
          }
        }).promise();
        console.log("DBPut", result);
      } catch (err) {
        console.log("DBError:", err);
        return { statusCode: 400, body: JSON.stringify({ errors: [{ message: "Bad Request." }] }) };
      }

      // const dob = new Date(validation_request.date_of_birth);
      const age = calculateAge(validation_request.date_of_birth);
      console.log('Age:', age);

      const validation_result = {
        id: id,
        decision: age >= 18 ? 1 : 0
      };
      console.log("ValidationResult:", validation_result);

      // Update low security data store with decision result.
      try {
        const result = await docClient.update({
          TableName: "decisions",
          Key: {
            id: validation_result.id
          },
          UpdateExpression: "set #s = :s, #d = :d, #u = :u",
          ExpressionAttributeNames: {
            "#s": "status",
            "#d": "decision",
            "#u": "updated"
          },
          ExpressionAttributeValues: {
            ":s": 1,
            ":d": validation_result.decision,
            ":u": new Date().toISOString()
          },
          ReturnValues: "UPDATED_NEW"
        }).promise();
        console.log("DBUpdate:", result);
      } catch(err) {
        console.log("DBError:", err);
        return { statusCode: 400, body: JSON.stringify({ errors: [{ message: "Bad Request." }] }) };
      }

      // Publish ValidationResult event to EventBridge. 
      try {
        const ebResult = await eb.putEvents({
          Entries: [
            {
              Detail: JSON.stringify({
                payload: {
                  id: validation_result.id
                }
              }),
              DetailType: "ValidationResult",
              Source: "civic.validator",
              Time: new Date
            }
          ]
        }).promise();
        console.log("ValidationResult sent:", ebResult);
      } catch(ex) {
        console.log("EBError:", ex);
      }
      break;
    }
    default: {
      console.log(`Received unknown event: "${event["detail-type"]}".`);
      console.log(event.detail);
      break;
    }
  }
}