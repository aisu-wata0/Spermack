const FormData = require('form-data');

const { TOKEN, COOKIE, TEAM_ID, CLAUDE,
  role_example_string_to_use,
  rename_roles,
  finish_message_chunk_with_this_role_only,
  when_msg_is_split_omit_role,
} = require('./config');
const { jail_context, include_assistant_tag } = require('./config');

const wait = (duration) => {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve();
    }, duration);
  });
};


function preparePrompt(messages) {
  return messages.filter(m => m.content?.trim()).map(m => {
    role = m.role;
    let author = '';
    let split = false;
    if (m.role.startsWith('SPLIT_ROLE')) {
      role = role.slice('SPLIT_ROLE'.length,);
      split = true;
    }
    let is_example = false;
    if (m.name && m.name.startsWith("example_")) {
      is_example = true;
    }
    if (role in rename_roles) {
      if (role != 'system') {
        author = rename_roles[role]
      } else {
        if (m.name) {
          if (is_example) {
            let name = m.name.slice("example_".length,)
            if (name in rename_roles) {
              author = role_example_string_to_use + rename_roles[name];
            }
          }
        } else {
          author = rename_roles[role];
        }
      }
    } else {
      author = role;
    }
    let f = ": ";
    if (!author) {
      f = "";
    }
    return `${author}${f}${m.content.trim()}`;
  }).join('\n\n');
}

function buildPrompt(messages) {
  prompt = preparePrompt(messages);
  return prompt;
};

const readBody = (res, json) => new Promise((resolve, reject) => {
  let buffer = '';

  res.on('data', chunk => {
      buffer += chunk;
  });

  res.on('end', () => {
      try {
          if (json) buffer = JSON.parse(buffer);
          resolve(buffer);
      } catch (e) {
          console.error(buffer);
          reject(e);
      }
  });
})

function getJailContext() {
  return `\n${jail_context}`
}

function removeJailContextFromMessage(message) {
  let escapedJailContext = getBlankPrompt();
  return message.slice(0, message.length - escapedJailContext.length);
}

const headers = {
  'Cookie': `d=${COOKIE};`,
  'User-Agent':	'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/112.0',
}

function splitMessageInTwo(text, maximumSplit) {
  // Split text in two, find the latest paragraph, or a newline, or just a sentence break, in this priority, to break it, worst case, use a space.
  // Important: be VERY carefull not to break markdown formatting
  // for example, you might find a \n\n, but you can't split there if it's inside "```" quotations
  let textToSearch = text;
  function splitIfFound(searchFunction, allowMarkdownInlineBreak = true, allowDelimiter = false) {
    let textToSearch = text;
    while (true) {
      let i = searchFunction(textToSearch);
      if (i !== -1 && !isInsideCodeBlock(textToSearch, i) &&
        (allowMarkdownInlineBreak || !isInsideMarkdownInline(textToSearch, i)) &&
        (allowDelimiter || !isInsideDelimiters(textToSearch, i)) &&
        textToSearch.slice(0, i).length <= maximumSplit) {
        return [text.slice(0, i), text.slice(i + 1)];
      }
      if (i === -1) break;
      textToSearch = textToSearch.slice(0, i);
    }
  }
  let result = null
  for (let delimBreak of [true, false]) {
    // Markdown title break 
    result = splitIfFound(text => text.lastIndexOf('\n#'), true, delimBreak);
    if (result) return result;
    // Check for paragraph break
    result = splitIfFound(text => text.lastIndexOf('\n\n'), true, delimBreak);
    if (result) return result;
    // Newline break 
    result = splitIfFound(text => text.lastIndexOf('\n'), true, delimBreak);
    if (result) return result;
    // Sentence break
    result = splitIfFound(findLastSentenceBreak, false, delimBreak);
    // Space break
    result = splitIfFound(text => text.lastIndexOf(' '), false, delimBreak);
    if (result) return result;
  }
  // Everything failed, split at maximum
  return [text.slice(0, maximumSplit), text.slice(maximumSplit + 1)];
}

function isInsideDelimiters(text, index) {
  const openDelimiters = /[\(\[\{<>]/g;
  const closeDelimiters = /[\)\]\}<>]/g;
  let openMatches = [];
  let closeMatches = [];
  let match;

  // Find opening delimiters
  while ((match = openDelimiters.exec(text)) !== null) {
    openMatches.push(match);
  }

  // Find closing delimiters
  while ((match = closeDelimiters.exec(text)) !== null) {
    closeMatches.push(match);
  }

  // Check if index is between an opening and closing delimiter
  for (let i = 0; i < openMatches.length; i++) {
    for (let j = closeMatches.length - 1; j >= 0; j--) {
      if (openMatches[i].index < index &&
        index < closeMatches[j].index &&
        (openMatches[i][0] === '(' && closeMatches[j][0] === ')') ||
        (openMatches[i][0] === '[' && closeMatches[j][0] === ']') ||
        (openMatches[i][0] === '{' && closeMatches[j][0] === '}')) {
        return true;
      }
    }
  }
  return false;
}

function isInsideMarkdownInline(text, index) {
  // Find pairs of formatting characters and capture the text in between them
  const format = /(\*|_|~){1,2}([\s\S]*?)\1{1,2}/gm;
  let matches = [];
  let match;
  while ((match = format.exec(text)) !== null) {
    matches.push(match);
  }
  // Check if index is between a pair of formatting characters
  for (let i = 0; i < matches.length; i++) {
    if (index > matches[i].index && index < matches[i].index + matches[i][0].length) {
      return true;
    }
  }
  return false;
}

function isInsideCodeBlock(text, index) {
  let textUpToIndex = text.slice(0, index);
  let matches = textUpToIndex.match(/```/gm);
  if (matches) {
    let numDelimiters = matches.length;
    return numDelimiters % 2 === 1;
  }
  return false;
}

function findLastSentenceBreak(text) {
  let sentenceBreaks = /[.!?]$/gm;
  let matches = text.match(sentenceBreaks);
  if (matches) {
    let lastIndex = 0;
    for (let i = 0; i < matches.length; i++) {
      lastIndex = text.lastIndexOf(matches[i]);
    }
    return lastIndex;
  }
  return -1;
}

function getMessageLength(msg) {
  const m_txt = buildPrompt([msg])
  return m_txt.length
}


function isMsgChatExample(msg) {
  if (msg.name && msg.name.startsWith("example_")) {
    return msg.name.slice("example_".length,);
  }
  return false;
}

function fixExamples(jsonArray) {
  if (jsonArray.length == 0) {
    return [];
  }
  console.log("Checking for empty reply examples");
  let current_examples = 0;
  let currentMsg = jsonArray[0];
  for (let i = 0; i < jsonArray.length; i++) {
    currentMsg = jsonArray[i];
    let name = isMsgChatExample(currentMsg)
    if (name) {
      current_examples++;
      if (i + 1 < jsonArray.length) {
        let isNextOneExample = isMsgChatExample(jsonArray[i + 1])
        if (!isNextOneExample) {
          // check if current message is from user, if yes, remove it as it has no response from AI
          if (name === 'user') {
            console.log("Removed empty reply example of i =", i);
            jsonArray.splice(i, 1);
            // DO NOT i--; // It will skip any [Start Chat] and thats ok
            // if you i--; then the current logic below breaks
            current_examples--;
          }
          if (current_examples == 0) {
            console.log("completely empty example, remove [Start chat] before this");
            // empty example, remove [Start chat] before this
            jsonArray.splice(i - 1, 1);
            i--; // just removed an element from list before i, this is so you don't skip an element
          }
          current_examples = 0;
        }
      }
    } else {
      if (currentMsg.role != 'system') {
        // should be end of examples. the initial prompt is given by system, and examples are handled
        // the only thing remaning is actual conversation
        console.log("Finshed examples at i =", i)
        break;
      }
      current_examples = 0;
    }
  }
  return jsonArray;
}

function splitJsonArray(jsonArray, maxLength) {
  jsonArray = fixExamples(jsonArray);
  const result = [];
  let currentChunk = [];
  let currentLength = 0;

  const addObjectToChunk = (object, chunk) => {
    chunk.push(object);
    // + 2 added because `buildPrompt` uses `.join('\n\n');`
    return currentLength + getMessageLength(object) + 2;
  };

  const appendTextToContent = (object, text) => {
    const newObj = JSON.parse(JSON.stringify(object));
    newObj.content += text;
    return newObj;
  };

  const assistant = `\n\n${rename_roles['assistant']}: `;
  const user = `\n\n${rename_roles['user']}: `;
  const textOverhead = Math.max(assistant.length, user.length, getJailContext().length);
  if (jsonArray.length == 0) {
    return [];
  }
  let currentMsg = jsonArray[0];
  let prevIdx = 0;
  let modifiedObj = false;
  for (let i = 0; i < jsonArray.length; i++) {
    if (!modifiedObj) {
      currentMsg = jsonArray[i];
    }
    prevIdx = i;
    const msgLength = getMessageLength(currentMsg) + 2;
    if (currentLength + msgLength + textOverhead <= maxLength) {
      if (modifiedObj) {
        modifiedObj = false;
      }
      currentLength = addObjectToChunk(currentMsg, currentChunk);
    } else {
      console.log("---- over maxLength  i=", i, "  currentMsg.role", currentMsg.role, "currentChunk.length=", currentChunk.length)
      if (currentChunk.length > 0) {
        const has_denied_end_of_chunk_role = finish_message_chunk_with_this_role_only &&
          (
          !currentChunk[currentChunk.length - 1].role.endsWith(finish_message_chunk_with_this_role_only)) && (
            // if the next one is also denied, this codition entirely and allow the msg to end on that role
            !currentMsg.role.endsWith(finish_message_chunk_with_this_role_only)
          )
        if (!has_denied_end_of_chunk_role || currentChunk.length < 2) {
          currentChunk[currentChunk.length - 1] = appendTextToContent(
            currentChunk[currentChunk.length - 1], getJailContext())
          result.push(currentChunk);

          currentChunk = [];
          currentLength = 0;
          i--; // critical so you don't go to next obj, and process this one instead
        } else {
          // the thing is that below this, another chunk will start with `currentMsg` as the first message
          // but the flag dictates the chunk can only start when the first message is from the role `finish_message_chunk_with_this_role_only`
          // Solution: remove last message from currentChunk and add to next chunk, together with `currentMsg`

          //  example:
          //   slices = [
          //     0,
          //     1,
          //     2,
          //   ];

          //   i = 2;
          //   // currentMsg (2) doesn't fit, and 1 (lastObjectInChunk) is denied by role
          //   state:
          //     currentChunk = [
          //       0,
          //       1, // denied, will pop()
          //     ];
          //     results = [];

          //   (same loop next commands and state)
          //   i=2
          //   currentChunk.pop();
          //   result.push(currentChunk);
          //   currentChunk = [];
          //   i -= 2; // 2 because you need to go back one, and for loop also does i++,
          //   state:
          //     currentChunk = [];
          //     results = [
          //       [
          //         0,
          //       ],
          //     ];

          //   (next loop, i++)
          //   i = 1;
          //   // ... adds 1 no prob
          //   state:
          //     currentChunk = [1];
          //     results = [
          //       [
          //         0,
          //       ],
          //     ];
          // // ... continues as normal, first chunk fixed (1 is not last msg)

          //   i = 1;
          //   // currentMsg (1) doesn't fit, and 0 (lastObjectInChunk) is denied by role
          //   state:
          //     currentChunk = [
          //       0, // will pop()
          //     ];
          //     results = [];

          //   (same loop next commands and state)
          //   i=1
          //   currentChunk.pop();
          //   result.push(currentChunk);
          //   currentChunk = [];
          //   i -= 2; // 2 because you need to go back one, and for loop also does i++,
          //   state:
          //     currentChunk = [];
          //     results = [
          //       [
          //         0,
          //       ],
          //     ];

          //   (next loop, i++)
          //   i = 1;
          //   // ... adds 1 no prob
          //   state:
          //     currentChunk = [1];
          //     results = [
          //       [
          //         0,
          //       ],
          //     ];
          // // ... continues as normal, first chunk fixed (1 is not last msg)
          console.log("Adding last chunk's msg to next one instead (end of chunk's msg had role denied by finish_message_chunk_with_this_role_only in config)")
          currentChunk.pop();
            currentChunk[currentChunk.length - 1] = appendTextToContent(
            currentChunk[currentChunk.length - 1], getJailContext())
          result.push(currentChunk);
          currentChunk = [];
          currentLength = 0;
          // the other one goes to next loop, crazy I know
          i -= 2; // critical so you don't go to next obj, and process lastObjectInChunk instead
          // which is 1 before current `i`, but the for loop adds one more, so subtract 2
        }
      } else {
        console.log("Message too big! It doesn't fit in a single chat message!", currentMsg.content.length)
        let splitContent = splitMessageInTwo(currentMsg.content, maxLength - textOverhead)
        let msgFirstSplit = { ...currentMsg, content: splitContent[0] };

        const msgFirstSplitWithJail = appendTextToContent(msgFirstSplit, getJailContext());
        currentChunk.push(msgFirstSplitWithJail);
        result.push(currentChunk);
        currentChunk = [];
        currentLength = 0;
        // the other one goes to next loop, crazy I know
        // I don't add her to the next chunk here because it could hypothetically need a split too
        let role = "SPLIT_ROLE";
        if (!when_msg_is_split_omit_role) {
          role = role + currentMsg.role;
        }
        currentMsg = { ...currentMsg, content: splitContent[1], role: role };
        modifiedObj = true;
        i--; // critical so you don't go to next obj, and process this one instead
        console.log("split into ", getMessageLength(msgFirstSplit), getMessageLength(currentMsg))
      }
    }
  }

  if (currentChunk.length > 0) {
    result.push(currentChunk);
  }

  if (include_assistant_tag){
    const lastChunk = result[result.length - 1];
    const lastObjectInLastChunk = lastChunk[lastChunk.length - 1];
    const lastObjectWithAssistant = appendTextToContent(lastObjectInLastChunk, assistant);
    const lastObjectWithAssistantLength = getMessageLength(lastObjectWithAssistant) + 2;

    if (currentLength - (getMessageLength(lastObjectInLastChunk) + 2) + lastObjectWithAssistantLength <= maxLength) {
      lastChunk[lastChunk.length - 1] = lastObjectWithAssistant;
    } else {
      console.warn("Something is very wrong")
    }
  }
  return result;
}


  
function convertToUnixTime(date) {
  const unixTime = Math.floor(date.getTime() / 1000);
  const randomDigit = Math.floor(Math.random() * 10);
  return `${unixTime}.xxxxx${randomDigit}`;
}

function createBaseForm() {
  const form = new FormData();
  form.append('token', TOKEN);
  form.append('channel', `${CLAUDE}`);
  form.append('_x_mode', 'online');
  form.append('_x_sonic', 'true');
  return form;
}

const currentTime = () => {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  const milliseconds = String(date.getMilliseconds()).padStart(3, '0');

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${milliseconds}`;
};

// Add the utility functions here
// e.g. escapePrompt, readBody, preparePrompt, currentTime, headers, convertToUnixTime, createBaseForm

module.exports = {
  buildPrompt,
  readBody,
  preparePrompt,
  currentTime,
  headers,
  convertToUnixTime,
  createBaseForm,
  splitJsonArray,
  wait,
  removeJailContextFromMessage,
};
