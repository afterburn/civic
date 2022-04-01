const AWS = require("aws-sdk");
AWS.config.update({ region: process.env.AWS_REGION });
const eb = new AWS.EventBridge();
const docClient = new AWS.DynamoDB.DocumentClient();
const kms = new AWS.KMS({ region: process.env.AWS_REGION });

const DEFAULT_RESPONSE = {
  headers: {
    "Access-Control-Allow-Headers" : "Content-Type",
    "Access-Control-Allow-Origin" : "*",
    "Access-Control-Allow-Credentials" : true
  }
}

const VALIDATION_STATUSES = {
  0: "PENDING",
  1: "FULFILLED"
}

async function encryptValue (input) {
  const { CiphertextBlob } = await kms.encrypt({
    KeyId: process.env.CIVIC_KEY,
    Plaintext: input
  }).promise();
  return CiphertextBlob.toString("base64");
}

async function encrypt (payload) {
  const encrypted = await Promise.all([
    encryptValue(payload.username),
    encryptValue(payload.full_name),
    encryptValue(payload.date_of_birth),
    encryptValue(payload.address),
    encryptValue(payload.phone_number),
  ]);
  return {
    username: encrypted[0],
    full_name: encrypted[1],
    date_of_birth: encrypted[2],
    address: encrypted[3],
    phone_number: encrypted[4],
  }
}

function bad_request(msg) {
  return {
    ...DEFAULT_RESPONSE,
    statusCode: 400,
    body: JSON.stringify({
      errors: [{ message: msg }]
    })
  }   
}

exports.handler = async (event, context) => {
  if (event.httpMethod === "DELETE") {
    const id = event.queryStringParameters
      ? event.queryStringParameters.id
      : null;
    if (!id) {
      return bad_request("Bad Request.")
    }
    const ebResult = await eb.putEvents({
      Entries: [
        {
          Detail: JSON.stringify({
            payload: {
              id
            }
          }),
          DetailType: "DeletionRequest",
          Source: "civic.gateway",
          Time: new Date
        }
      ]
    }).promise();
    console.log("DeletionRequest sent:", ebResult);
    return {
      ...DEFAULT_RESPONSE,
      statusCode: 200,
      body: JSON.stringify({
        payload: null
      })
    }
  }

  // User requests validation status.
  if (event.httpMethod === "GET") {
    const id = event.queryStringParameters
      ? event.queryStringParameters.id
      : null;
    if (!id) {
      return bad_request("Bad Request.")
    }
    try {
      const result = await docClient.get({
        TableName: "decisions",
        Key: {
          id
        }
      }).promise();
      console.log("DBGet:", result)
      if (!result.Item || result.Item.status === 0) {
        return {
          ...DEFAULT_RESPONSE,
          statusCode: 200,
          body: JSON.stringify({
            payload: {
              status: VALIDATION_STATUSES[0]
            }
          })
        };
      }
      return {
        ...DEFAULT_RESPONSE,
        statusCode: 200,
        body: JSON.stringify({
          payload: {
            status: VALIDATION_STATUSES[result.Item.status],
            decision: result.Item.decision === 1
          }
        })
      };
    } catch(ex) {
      console.log("Error:", ex)
    }
  }

  // User submits validation request.
  if (!event.body) {
    return bad_request("Bad Request.")
  }
  const id = AWS.util.uuid.v4();
  const validation_request = {
    id,
    ...JSON.parse(event.body)
  };
  try {
    const payload = await encrypt(validation_request);
    payload.id = id;
    
    const ebResult = await eb.putEvents({
      Entries: [
        {
          Detail: JSON.stringify({ payload }),
          DetailType: "ValidationRequest",
          Source: "civic.gateway",
          Time: new Date
        }
      ]
    }).promise();
    console.log("ValidationRequest sent:", ebResult);
    return {
      ...DEFAULT_RESPONSE,
      statusCode: 200,
      body: JSON.stringify({ payload: id })
    };
  } catch(ex) {
    console.log(ex)
    return bad_request("Internal server error..")
  }
}