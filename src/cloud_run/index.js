const functions = require('@google-cloud/functions-framework');
const axios = require('axios');


// Register a CloudEvent function
functions.cloudEvent('pushProxy', async cloudEvent => {

  const {
    GAS_API_URL,
    GAS_API_KEY
  } = process.env;

  console.log(GAS_API_KEY);

  try {
    // console.log('Received Pub/Sub notification:', JSON.stringify(cloudEvent, null, 2));

    const pubsubMessage = cloudEvent.data;

    if (!pubsubMessage || !pubsubMessage.message) {
      console.log('No message data found');
      return;
    }

    // Decode the Base64 message
    const messageData = Buffer.from(pubsubMessage.message.data, 'base64').toString();
    // console.log('Decoded message:', messageData);

    let notification;
    try {
      notification = JSON.parse(messageData);
    } catch (err) {
      console.error('Failed to parse message JSON:', err);
      return;
    }

    const { emailAddress, historyId } = notification;

    if (!emailAddress || !historyId) {
      console.log('Missing emailAddress or historyId');
      return;
    }

    console.log(`Relaying Gmail notification for ${emailAddress} with historyId ${historyId}...`);

    // Send to Apps Script Web App
    const response = await axios.post(GAS_API_URL, {
      apiKey: GAS_API_KEY,
      task: "processNewEmails",
      data: {
        emailAddress,
        historyId
      }
    });

    console.log(`Apps Script responded with status ${response.status} and success is ${response.data.success}:`, response.data.message);

  } catch (error) {
    console.error('Error in pushProxy handler:', error);
  }
});
