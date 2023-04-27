const FormData = require('form-data');

const { TOKEN, COOKIE, TEAM_ID, CLAUDE } = require('./config');
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
    let author = '';
    switch (m.role) {
      case 'user': author = 'Human'; break;
      case 'assistant': author = 'Assistant'; break;
      case 'system':
        if (m.name) {
          author = m.name;
        } else {
          author = 'System Note';
        }
        break;
      default: author = m.role; break;
    }

    return `${author}: ${m.content.trim()}`;
  }).join('\n\n');
}

function buildPrompt(messages, is_last_message = true) {
  prompt = preparePrompt(messages, is_last_message);
  const escapedPrompt = prompt.replace(/\r?\n|\r/g, '\\n').replace(/"/g, '\\"');
  return escapedPrompt;
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
  let escapedJailContext = getBlankPrompt().replace(/\r?\n|\r/g, '\\n').replace(/"/g, '\\"');
  return message.slice(0, message.length - escapedJailContext.length);
}

const headers = {
  'Cookie': `d=${COOKIE};`,
  'User-Agent':	'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/112.0',
}

function splitJsonArray(jsonArray, maxLength) {
  const result = [];
  let currentChunk = [];
  let currentLength = 0;

  const addObjectToChunk = (object, chunk) => {
    chunk.push(object);
    // + 2 added because `buildPrompt` uses `.join('\n\n');`
    return currentLength + buildPrompt([object]).length + 2;
  };

  const appendTextToContent = (object, text) => {
    const newObj = JSON.parse(JSON.stringify(object));
    newObj.content += text;
    return newObj;
  };

  const assistant = "\n\nAssistant: ";
  const textOverhead = Math.max(getJailContext().length, assistant.length);

  for (const obj of jsonArray) {
    const objLength = buildPrompt([obj]).length + 2;

    if (currentLength + objLength + textOverhead <= maxLength) {
      currentLength = addObjectToChunk(obj, currentChunk);
    } else {
      const lastObjectInChunk = currentChunk[currentChunk.length - 1];
      const lastObjectWithJail = appendTextToContent(lastObjectInChunk, getJailContext());
      // lastObject is guaranteed to fit (with jail) because it passes the check above, unlike the current object, on the previous loop.
      currentChunk[currentChunk.length - 1] = lastObjectWithJail;

      result.push(currentChunk);
      currentChunk = [obj];
      // - 2 because the `.join('\n\n');` from `buildPrompt` doesn't apply to the first message
      currentLength = objLength - 2;
    }
  }

  if (currentChunk.length > 0) {
    result.push(currentChunk);
  }

  if (include_assistant_tag){
    const lastChunk = result[result.length - 1];
    const lastObjectInLastChunk = lastChunk[lastChunk.length - 1];
    const lastObjectWithAssistant = appendTextToContent(lastObjectInLastChunk, assistant);
    const lastObjectWithAssistantLength = buildPrompt([lastObjectWithAssistant]).length + 2;

    if (currentLength - (buildPrompt([lastObjectInLastChunk]).length + 2) + lastObjectWithAssistantLength <= maxLength) {
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
