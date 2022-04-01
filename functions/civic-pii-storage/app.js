const AWS = require("aws-sdk");
AWS.config.update({ region: process.env.AWS_REGION });
const eb = new AWS.EventBridge();
const docClient = new AWS.DynamoDB.DocumentClient();

exports.handler = async (event) => {
  if (!event.detail) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        errors: [{ message: "Bad Request." }]
      })
    }
  }
  const eventType = event["detail-type"];
  switch(eventType) {
    case "DeletionRequest": {
      const id = event.detail.payload.id;
      console.log("DeletionRequest:",  event.detail.payload);
      const dbResult = await docClient.delete({
        TableName: 'pii',
        Key: {
          id
        }
      }).promise();
      console.log("DeletionRequest processes", dbResult);
      break;
    }
    case "ValidationRequest": {
      try {
        const now = new Date();
        console.log("ValidationRequest:", event.detail.payload);

        const db_result = await docClient.put({
          TableName: "pii",
          Item: {
            ...event.detail.payload,            
            created: now.toISOString(),
            updated: now.toISOString()
          }
        }).promise();
        console.log("DBPut", db_result);
        
        const ebResult = await eb.putEvents({
          Entries: [
            {
              Detail: JSON.stringify({
                payload: {
                  id: event.detail.payload.id
                }
              }),
              DetailType: "DataStored",
              Source: "civic.pii-storage",
              Time: new Date
            }
          ]
        }).promise();
        console.log("DataStored sent:", ebResult);
        return {
          statusCode: 200,
          body: JSON.stringify({ payload: null })
        };
      } catch (err) {
        console.log(err);
        return {
          statusCode: 500,
          body: JSON.stringify({
            errors: [{ message: err }]
          })
        }
      }
    }

    default: {
      return {
        statusCode: 500,
        body: JSON.stringify({
          errors: [{ message: "Internal server error." }]
        })
      }
    }
  }
};
