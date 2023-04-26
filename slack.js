const https = require('https');
const WebSocket = require('ws');

const { TOKEN, COOKIE, TEAM_ID } = require('./config');
const { readBody, headers, createBaseForm, convertToUnixTime, currentTime, buildPrompt } = require('./utils');

function Uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0,
          v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

async function sendPromptMessage(prompt) {
    const form = createBaseForm();
  
    form.append('ts', convertToUnixTime(new Date()));
    form.append('type', 'message');
    form.append('xArgs', '{}');
    form.append('unfurl', '[]');
    form.append('blocks', `[{"type":"rich_text","elements":[{"type":"rich_text_section","elements":[{"type":"text","text":"${prompt}"}]}]}]`);
    form.append('include_channel_perm_error', 'true');
    form.append('client_msg_id', Uuidv4());
    form.append('_x_reason', 'webapp_message_send');
  
    const options = {
      method: 'POST',
      headers: {
        ...headers,
        ...form.getHeaders(),
      },
    };
  
    const req = https.request(`https://${TEAM_ID}.slack.com/api/chat.postMessage`, options, async (res) => {
      try {
        const response = await readBody(res, true);
        console.log(response);
      } catch (error) {
        console.error(error);
      }
    });
  
    req.on('error', (error) => {
      console.error(error);
    });
  
    form.pipe(req);
  }
  
  async function sendChatReset() {
    const form = createBaseForm();
  
    form.append('command', '/reset');
    form.append('disp', '/reset');
    form.append('client_token', `${new Date().getTime()}`);
    form.append('_x_reason', 'executeCommand');
  
    const options = {
      method: 'POST',
      headers: {
        ...headers,
        ...form.getHeaders(),
      },
    };
  
    const req = https.request(`https://${TEAM_ID}.slack.com/api/chat.command`, options, async (res) => {
      try {
        const response = await readBody(res, true);
        console.log(response);
      } catch (error) {
        console.error(error);
      }
    });
  
    req.on('error', (error) => {
      console.error(error);
    });
  
    form.pipe(req);
  }
  
  async function waitForWebSocketResponse(messages) {
    return new Promise(async (resolve, reject) => {
      const websocketURL = `wss://wss-primary.slack.com/?token=${TOKEN}`;
  
      const websocket = new WebSocket(websocketURL, {
        headers: headers,
      });
  
      const waitForConnection = new Promise((connectionResolve) => {
        websocket.on('open', () => {
          console.log('Connected to WebSocket');
          connectionResolve();
        });
      });
  
      await waitForConnection;
  
      let messageIndex = 0;
      const sendNextPrompt = async () => {
        if (messageIndex < messages.length) {
          const prompt = buildPrompt(messages[messageIndex]);
          await sendPromptMessage(prompt);
          messageIndex++;
        }
      };
  
      await sendNextPrompt();
  
      websocket.on('message', async (message) => {
        try {
          const data = JSON.parse(message);
          if (data.subtype === 'message_changed') {
            if (!data.message.text.endsWith("_Typing…_")) {
              if (messageIndex < messages.length) {
                await sendNextPrompt();
              } else {
                websocket.close();
                resolve(data.message.text);
              }
            } else {
              console.log(`${currentTime()} fetched ${data.message.text.length} characters...`);
            }
          }
        } catch (error) {
          console.error('Error parsing message:', error);
          reject(error);
        }
      });
  
      websocket.on('error', (error) => {
        console.error('WebSocket error:', error.toString());
        reject(error);
      });
    });
  }
  

module.exports = {
  sendPromptMessage,
  sendChatReset,
  waitForWebSocketResponse,
};
