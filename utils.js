const FormData = require('form-data');

const { TOKEN, COOKIE, TEAM_ID, CLAUDE,
  user_name,
  assistant_name,
  system_name,
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
    const f = ": ";
    let author = '';
    switch (m.role) {
      case 'user': author = user_name + f; break;
      case 'assistant': author = assistant_name + f; break;
      case 'system':
        if (m.name) {
          author = m.name + f;
        } else {
          author = system_name + f;
        }
        break;
      case 'SPLIT_ROLE':
        author = '';
        break;
      default: author = m.role + f; break;
    }

    return `${author}${m.content.trim()}`;
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
  // Check for paragraph break
  let textToSearch = text;
  // Paragraph break loop
  while (true) {
    let i = textToSearch.lastIndexOf('\n\n');
    if (i !== -1 && !isInsideCodeBlock(textToSearch, i) &&
      textToSearch.slice(0, i).length <= maximumSplit) {
      return [text.slice(0, i), text.slice(i + 2)];
    }
    if (i === -1) break;
    textToSearch = textToSearch.slice(0, i);
  }
  // Newline break loop
  textToSearch = text;
  while (true) {
    let i = textToSearch.lastIndexOf('\n');
    if (i !== -1 && !isInsideCodeBlock(textToSearch, i) &&
      textToSearch.slice(0, i).length <= maximumSplit) {
      return [text.slice(0, i), text.slice(i + 1)];
    }
    if (i === -1) break;
    textToSearch = textToSearch.slice(0, i);
  }
  // Sentence break loop
  textToSearch = text;
  while (true) {
    let i = findLastSentenceBreak(textToSearch);
    if (i !== -1 && !isInsideCodeBlock(textToSearch, i) &&
      textToSearch.slice(0, i + 1).length <= maximumSplit) {
      return [text.slice(0, i), text.slice(i + 1)];
    }
    if (i === -1) break;
    textToSearch = textToSearch.slice(0, i);
  }
  // Everything failed, split at maximum
  return [text.slice(0, maximumSplit), text.slice(maximumSplit + 1)];
}

function isInsideCodeBlock(text, index) {
  let textUpToIndex = text.slice(0, index);
  let matches = textUpToIndex.match(/^```|\n```/gm);
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

function splitJsonArray(jsonArray, maxLength) {
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

  const assistant = "\n\nAssistant: ";
  const textOverhead = Math.max(getJailContext().length, assistant.length);
  if (jsonArray.length == 0) {
    return [];
  }
  let currentMsg = jsonArray[0];
  let prevIdx = 0;
  for (let i = 0; i < jsonArray.length; i++) {
    if (i != prevIdx) {
      // ctrl+f 'i--'
      currentMsg = jsonArray[i];
    }
    prevIdx = i;
    const msgLength = getMessageLength(currentMsg) + 2;
    if (currentLength + msgLength + textOverhead <= maxLength) {
      currentLength = addObjectToChunk(currentMsg, currentChunk);
    } else {
      if (currentChunk.length > 0) {
        const lastObjectInChunk = currentChunk[currentChunk.length - 1];
        const lastObjectWithJail = appendTextToContent(lastObjectInChunk, getJailContext());
        currentChunk[currentChunk.length - 1] = lastObjectWithJail;

        result.push(currentChunk);
        currentChunk = [currentMsg];
        // - 2 because the `.join('\n\n');` from `buildPrompt` doesn't apply to the first message
        currentLength = msgLength - 2;
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
        currentMsg = { ...currentMsg, content: splitContent[1], role: "SPLIT_ROLE" };
        i--; // so you don't go to next obj, and process this one instead
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
