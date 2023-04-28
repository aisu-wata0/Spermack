const https = require('https');
const WebSocket = require('ws');

const { TOKEN, COOKIE, TEAM_ID, CLAUDE_MEMBER_ID } = require('./config');
const {
  blank_prompt,
  jail_context_expected_responses,
  jail_context_retry_attempts,
  jail_retry_attempts,
  jail_filtered_responses,
  retry_delay,
} = require('./config');
const { readBody, headers, createBaseForm, convertToUnixTime, currentTime, buildPrompt, removeJailContextFromMessage, wait, } = require('./utils');

function Uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0,
          v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

async function sendMessage(message) {
  return new Promise((resolve, reject) => {

    const blocks_json = [{ "type": "rich_text", "elements": [{ "type": "rich_text_section", "elements": [{ "type": "text", "text": message }] }] }];
    const blocks_txt = JSON.stringify(blocks_json);
    const form = createBaseForm();
    form.append('ts', convertToUnixTime(new Date()));
    form.append('type', 'message');
    form.append('xArgs', '{}');
    form.append('unfurl', '[]');
    form.append('blocks', blocks_txt);
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
        console.log("\nblocks length:", blocks_txt.length);
        const response = await readBody(res, true);
        if (!response.ok) {
          reject(new Error("message response:" + response.error.toString() + "\nrequest:" + form.getBuffer() + "\n"));
          return;
        }
        resolve(response);
      } catch (error) {
        console.error(error);
        reject(new Error(error.message + "| " + "while sending message " + " request:" + form.getBuffer() + "\n"));
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
        resolve(response);
      } catch (error) {
        console.error(error);
        reject(new Error(error.message + "| " + "editMessage" + " request:" + form.getBuffer() + "\n"));
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
        reject(new Error(error.message + "| " + "sendChatReset: " + " request:" + form.getBuffer() + "\n"));
      }
    });

    req.on('error', (error) => {
      console.error(error);
      reject(error); // Reject with the error
    });

    form.pipe(req);
  });
}

async function streamResponse(slices, sendChunks) {
  const resultStream = await getWebSocketResponse(slices, true);
  const reader = resultStream.getReader();
  let nextChunk = await reader.read();
  while (true) {
    sendChunks(nextChunk);
    if (nextChunk.done) {
      return;
    }
    nextChunk = await reader.read();
  }
}

async function streamResponseRetryable(slices, sendChunks, retries = {
  "Jailbreak context failed": jail_context_retry_attempts,
  "Jailbreak failed": jail_retry_attempts,
}, retryDelay = retry_delay) {
  try {
    const response = await streamResponse(slices, sendChunks);
    return response;
  } catch (error) {
    console.log("retries left:", retries);
    for (let key in retries) {
      let retryOnErrorString = key;
      let retryCount = retries[key]
      if (retryCount <= 0) {
        throw error;
      }
      if (error.message.includes(retryOnErrorString)) {
        console.log("+ Retrying: retryable error found while attempted to streamResponse:", retryOnErrorString);
        if (retryDelay) {
          await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
        return streamResponseRetryable(slices, sendChunks, {
          ...retries,
          retryOnErrorString: retryCount - 1,
        }, retryDelay);
      } else {
        console.error(error);
        throw new Error(error.message + "| " + "streamResponseRetryable");
      }
    }
  }
}

async function retryableWebSocketResponse(messages, streaming, editing = false, retries = {
  "Jailbreak context failed": jail_context_retry_attempts,
  "Jailbreak failed": jail_retry_attempts,
}, retryDelay = retry_delay) {
  try {
    const response = await getWebSocketResponse(messages, streaming, editing);
    return response;
  } catch (error) {
    for (let key in retries) {
      console.log("retries left:", retries);
      let retryOnErrorString = key;
      let retryCount = retries[key]
      if (retryCount <= 0) {
        throw error;
      }
      if (error.message.includes(retryOnErrorString)) {
        console.log("+ Retrying: retryable error found while attempted to streamResponse:", retryOnErrorString);
        if (retryDelay) {
          await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
        return retryableWebSocketResponse(messages, streaming, editing, {
          ...retries,
          retryOnErrorString: retryCount - 1,
        }, retryDelay);
      } else {
        console.error(error);
        throw new Error(error.message + "| " + "retryableWebSocketResponse");
      }
    }
  }
}

async function getWebSocketResponse(messages, streaming, editting = false) {
  return new Promise(async (resolve, reject) => {
    try {
      await sendChatReset();
    } catch (error) {
      console.error(error);
      reject(new Error(error.message + "| " + "!!!! CHECK YOUR TOKENS, COOKIES./ config.js"))
    }

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
          let newText = removeJailContextFromMessage(updatedPrompt);
          await wait(50);
          await editMessage(sentTs, newText);
          await wait(150);
        }
        console.log("Sending message %d/%d", messageIndex, messages.length - 1);
        let is_last_message = messageIndex == messages.length - 1
        const prompt = buildPrompt(messages[messageIndex], is_last_message);
        try {
          response = await sendMessage(prompt);
          sentTs = response.ts;
        } catch (error) {
          console.error(error.stack);
          throw (new Error(error.message + "| " + `sendNextPrompt: ${error.message}`))
        }
        console.log("Sent %d", messageIndex);
        messageIndex++;
      }
    };

    try {
      await sendNextPrompt();
    } catch (error) {
      console.error(error);
      reject(new Error(error.message + "| " + `sendNextPrompt: ${error.message}`));
    }

    let typingString = "\n\n_Typing…_";


    const checkJailbreakContext = (currentTextTotal) => {
      currentTextTotal = currentTextTotal.trim();
      let maxLen = 0
      for (let expected_response of jail_context_expected_responses) {
        maxLen = Math.max(maxLen, expected_response.length)
      }
      if (currentTextTotal.length > maxLen) {
        return true
      }
      for (let expected_response of jail_context_expected_responses) {
        if (currentTextTotal.startsWith(expected_response.slice(0, currentTextTotal.length))) {
          return false
        }
      }
      return true
    }

    const checkJailbreak = (currentTextTotal) => {
      currentTextTotal = currentTextTotal.trim();
      for (let filtered_response of jail_filtered_responses) {
        if (currentTextTotal.includes(filtered_response)) {
          return true
        }
      }
      return false
    }

    if (!streaming) {
      // resolve the full text at the end only
      websocket.on('message', async (message) => {
        try {
          const data = JSON.parse(message);
          // Extract the sender ID from the payload
          if (data.message) {
            let senderId = data.message.user;
            if (data.subtype === 'message_changed' && (!editting || (CLAUDE_MEMBER_ID && senderId === CLAUDE_MEMBER_ID))) {
              if (messageIndex < messages.length) {
                // while context to send still...
                if (!data.message.text.endsWith(typingString)) {
                  // if bot stopped responding to previous message, send the next one
                  // but first check if jail_context worked
                  let currentTextTotal = data.message.text;
                  if (checkJailbreakContext(currentTextTotal)) {
                    throw new Error(`Jailbreak context failed, reply was: ${currentTextTotal}`)
                  }
                  try {
                    await sendNextPrompt();
                  } catch (error) {
                    console.error(error);
                    throw new Error(error.message + "| " + `Error while sending next prompt: ${error.message}`);
                  }
                }
              } else {
                // all context sent, getting actual reply
                if (!data.message.text.endsWith(typingString)) {
                  // when typing finished, this is the end of the message
                  let currentTextTotal = data.message.text;
                  if (checkJailbreak(currentTextTotal)) {
                    throw new Error(`Jailbreak failed, reply was: ${currentTextTotal}`)
                  }
                  websocket.close(1000, 'Connection closed by client');
                  resolve(data.message.text);
                } else {
                  let actualLength = data.message.text.length - typingString.length;
                  let currentTextTotal = data.message.text.slice(0, actualLength);
                  console.log(`${currentTime()} fetched ${currentTextTotal.length} characters...`);
                }
              }
            }
            else if (data.subtype === 'message_changed') {
              if (editting && !CLAUDE_MEMBER_ID) {
                console.warn("editting is set to true, but you forgot to set `CLAUDE_MEMBER_ID`, are you stupid or something?")
              }
            }
          }
        } catch (error) {
          console.error(error);
          websocket.close(1000, 'Connection closed by client');
          reject(new Error(error.message + "| " + "getWebSocketResponse: "))
        }
      });

      websocket.on('error', (error) => {
        console.error(error);
        controller.error(new Error(error.message + "| " + 'WebSocket error'));
      });
      websocket.on('close', (code, reason) => {
        if (code != 1000) {
          console.log(`WebSocket closed with code ${code} and reason: ${reason.toString()}`);
        }
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
                if (data.subtype === 'message_changed' && (!editting || (CLAUDE_MEMBER_ID && senderId === CLAUDE_MEMBER_ID))) {
                  if (messageIndex < messages.length) {
                    // while context to send still...
                    if (!data.message.text.endsWith(typingString)) {
                      // if bot stopped responding to previous message, send the next one
                      // but first check if jail_context worked
                      let currentTextTotal = data.message.text;
                      if (checkJailbreakContext(currentTextTotal)) {
                        throw new Error(`Jailbreak context failed, reply was: ${currentTextTotal}`)
                      }
                      try {
                        await sendNextPrompt();
                      } catch (error) {
                        console.error(error);
                        throw new Error(error.message + "| " + `Error while sending next prompt: ${error.message}`);
                      }
                    }
                  } else {
                    // all context sent, getting actual reply
                    if (!data.message.text.endsWith(typingString)) {
                      // when typing finished, this is the end of the message
                      let currentTextTotal = data.message.text;
                      if (checkJailbreak(currentTextTotal)) {
                        throw new Error(`Jailbreak failed, reply was: ${currentTextTotal}`)
                      }
                      let currentTextChunk = data.message.text.slice(currentSlice);
                      currentSlice = data.message.text.length;
                      console.log("Finished:", data.message.text.length, " characters");
                      controller.enqueue(currentTextChunk);
                      controller.close();
                      websocket.close(1000, 'Connection closed by client');
                    } else {
                      let actualLength = data.message.text.length - typingString.length
                      let currentTextChunk = data.message.text.slice(currentSlice, actualLength);
                      currentSlice = actualLength
                      console.log("Sending :", currentTextChunk.length, " characters");
                      controller.enqueue(currentTextChunk);
                    }
                  }
                }
                else if (data.subtype === 'message_changed') {
                  if (editting && !CLAUDE_MEMBER_ID) {
                    console.warn("`editting` is set to true, but you forgot to set `CLAUDE_MEMBER_ID`, are you stupid or something?")
                  }
                }
              }
            } catch (error) {
              console.error(error);
              websocket.close(1000, 'Connection closed by client');
              controller.error(new Error(error.message + "| " + "getWebSocketResponse: "));
            }
          });
          websocket.on('error', (error) => {
            console.error(error);
            controller.error(new Error(error.message + "| " + 'WebSocket error'));
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
  retryableWebSocketResponse,
  streamResponseRetryable,
};
