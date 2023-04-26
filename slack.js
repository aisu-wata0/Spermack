const https = require('https');
const WebSocket = require('ws');

const { TOKEN, COOKIE, TEAM_ID, CLAUDE_MEMBER_ID } = require('./config');
const { blank_prompt } = require('./config');
const { readBody, headers, createBaseForm, convertToUnixTime, currentTime, buildPrompt, removeBlankPromptFromMessage, wait, } = require('./utils');

function Uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0,
          v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

async function sendMessage(message) {
  return new Promise((resolve, reject) => {
    const form = createBaseForm();

    form.append('ts', convertToUnixTime(new Date()));
    form.append('type', 'message');
    form.append('xArgs', '{}');
    form.append('unfurl', '[]');
    form.append('blocks', `[{"type":"rich_text","elements":[{"type":"rich_text_section","elements":[{"type":"text","text":"${message}"}]}]}]`);
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
        resolve(response.ts);
      } catch (error) {
        console.error(error);
        reject(error);
      }
    });

    req.on('error', (error) => {
      console.error(error);
    });

    form.pipe(req);
  });
}

async function editMessage(ts, newText) {
  return new Promise((resolve, reject) => {
    const form = createBaseForm();

    form.append('ts', ts);
    form.append('type', 'message');
    form.append('xArgs', '{}');
    form.append('unfurl', '[]');
    form.append('blocks', `[{"type":"rich_text","elements":[{"type":"rich_text_section","elements":[{"type":"text","text":"${newText}"}]}]}]`);
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

    const req = https.request(`https://${TEAM_ID}.slack.com/api/chat.update`, options, async (res) => {
      try {
        const response = await readBody(res, true);
        console.log(response);
        resolve(response);
      } catch (error) {
        console.error(error);
        reject(error);
      }
    });

    req.on('error', (error) => {
      console.error(error);
      reject(error);
    });

    form.pipe(req);
  });
}

async function sendChatReset() {
  return new Promise((resolve, reject) => {
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
        resolve(response); // Resolve with the response data
      } catch (error) {
        console.error(error);
        reject(error); // Reject with the error
      }
    });

    req.on('error', (error) => {
      console.error(error);
      reject(error); // Reject with the error
    });

    form.pipe(req);
  });
}


async function getWebSocketResponse(messages, streaming, editting = false) {
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
    let sentTs = null;
    const sendNextPrompt = async () => {
      if (messageIndex < messages.length) {
        if (editting && blank_prompt && messageIndex > 0) {
          // this was implemented with this idea:
          // edit previous message, to remove the AI gaslighting blank_prompt
          // as if it never happened ( ˘ᴗ˘ )
          // ---
          // but with further testing I found out that Claude saves the chat history internally as the messages come to it
          // i.e. he doesn't care about the revised chat history, only what he initially replied to
          console.log("Editting message %d", messageIndex - 1);
          let updatedPrompt = buildPrompt(messages[messageIndex - 1], false);
          let newText = removeBlankPromptFromMessage(updatedPrompt);
          await wait(50);
          await editMessage(sentTs, newText);
          await wait(150);
        }
        console.log("Sending message %d/%d", messageIndex, messages.length - 1);
        let is_last_message = messageIndex == messages.length - 1
        const prompt = buildPrompt(messages[messageIndex], is_last_message);
        sentTs = await sendMessage(prompt);
        console.log("Sent %d", messageIndex);
        messageIndex++;
      }
    };

    await sendNextPrompt();
    await wait(200);

    let typingString = "\n\n_Typing…_";

    if (!streaming) {
      // resolve the full text at the end only
      websocket.on('message', async (message) => {
        try {
          const data = JSON.parse(message);
          // Extract the sender ID from the payload
          if (data.message) {
            let senderId = data.message.user;
            console.log("===================");
            console.log("CLAUDE_MEMBER_ID", CLAUDE_MEMBER_ID);
            console.log("senderId", senderId);
            console.log("data.subtype", data.subtype);
            senderId = data.message.user;
            if (data.subtype === 'message_changed' && (!editting || (CLAUDE_MEMBER_ID && senderId === CLAUDE_MEMBER_ID))) {
              // while messages to send still...
              if (!data.message.text.endsWith(typingString)) {
                if (messageIndex < messages.length) {
                  // if bot stopped responding to previous message, send the next one
                  await sendNextPrompt();
                } else {
                  websocket.close();
                  resolve(data.message.text);
                }
              } else {
                console.log(`${currentTime()} fetched ${data.message.text.length} characters...`);
              }
            }
            else if (data.subtype === 'message_changed') {
              if (editting && !CLAUDE_MEMBER_ID) {
                console.warn("editting is set to true, but you forgot to set `CLAUDE_MEMBER_ID`, are you stupid or something?")
              }
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

      websocket.on('close', (code, reason) => {
        console.log(`WebSocket closed with code ${code} and reason: ${reason.toString()}`);
      });
    } else {
      // resolve a ReadableStream to stream the websocket's response
      let stream = new ReadableStream({
        start(controller) {
          let currentSlice = 0;
          websocket.on('message', async (message) => {
            try {
              const data = JSON.parse(message);
              // Extract the sender ID from the payload
              if (data.message) {
                let senderId = data.message.user;
                senderId = data.message.user;
                if (senderId === CLAUDE_MEMBER_ID && data.subtype === 'message_changed') {
                  if (messageIndex < messages.length) {
                    // while messages to send still...
                    if (!data.message.text.endsWith(typingString)) {
                      // if bot stopped responding to previous message, send the next one
                      await sendNextPrompt();
                    }
                  } else {
                    // all prompt sent, get response
                    if (!data.message.text.endsWith(typingString)) {
                      // when typing finished, this is the end of the message
                      let currentTextChunk = data.message.text.slice(currentSlice);
                      currentSlice = data.message.text.length;
                      console.log("Finished:", data.message.text);
                      controller.enqueue(currentTextChunk);
                      controller.close();
                      websocket.close(1000, 'Connection closed by client');
                    } else {
                      let actualLength = data.message.text.length - typingString.length
                      let currentTextChunk = data.message.text.slice(currentSlice, actualLength);
                      currentSlice = actualLength
                      console.log("Sending :", currentTextChunk);
                      controller.enqueue(currentTextChunk);
                    }
                  }
                }
              }
            } catch (error) {
              console.error('Error parsing message:', error);
              controller.error(error);
            }
          });
          websocket.on('error', (error) => {
            console.error('WebSocket error:', error.toString());
            controller.error(error);
          });
          websocket.on('close', (code, reason) => {
            if (code != 1000) {
              console.log(`WebSocket closed with code ${code} and reason: ${reason.toString()}`);
            }
          });

        }
      });

      resolve(stream);
    }
  });
}

function deleteAllMessages(channelId) {
  const requestOptions = {
    method: 'POST',
    path: `/api/conversations.history?channel=${channelId}`,
    headers: {
      ...headers,
      ...form.getHeaders(),
    },
  };

  const req = https.request(requestOptions, (res) => {
    let data = '';
    res.on('data', (chunk) => {
      data += chunk;
    });
    res.on('end', () => {
      const messages = JSON.parse(data).messages;
      messages.forEach((message) => {
        const deleteOptions = {
          method: 'POST',
          path: '/api/chat.delete',
          headers: {
            'Content-Type': 'application/json',
          },
        };
        const deleteReq = https.request(deleteOptions, (deleteRes) => { });
        deleteReq.write(JSON.stringify({ channel: channelId, ts: message.ts }));
        deleteReq.end();
      });
    });
  });

  req.end();
}


module.exports = {
  sendMessage,
  sendChatReset,
  getWebSocketResponse,
};
