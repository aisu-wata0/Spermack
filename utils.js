const FormData = require('form-data');

const { TOKEN, COOKIE, TEAM_ID, CLAUDE } = require('./config');

const wait = (duration) => {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve();
    }, duration);
  });
};

function buildPrompt(messages) {
    prompt = preparePrompt(messages);
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
  
  function preparePrompt(messages) {
    return messages.filter(m => m.content?.trim()).map(m => {
        let author = '';
        switch (m.role) {
            case 'user': author = 'Human'; break;
            case 'assistant': author = 'Assistant'; break;
            case 'system': author = 'System Note'; break;
            default: author = m.role; break;
        }
  
        return `${author}: ${m.content.trim()}`;
    }).join('\n\n') + `\nAssistant: `;
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
  
  const headers = {
    'Cookie': `d=${COOKIE};`,
    'User-Agent':	'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/112.0',
  }
  
  function splitJsonArray(jsonArray, maxLength) {
    let result = [];
    let currentChunk = [];
    let currentLength = 2; // Accounts for the opening and closing square brackets in the JSON array
  
    jsonArray.forEach((obj) => {
      const jsonString = JSON.stringify(obj);
      const objLength = jsonString.length + 1; // +1 for the comma between objects
  
      if (currentLength + objLength <= maxLength) {
        currentChunk.push(obj);
        currentLength += objLength;
      } else {
        // Store the current chunk and start a new one
        result.push(currentChunk);
        currentChunk = [obj];
        currentLength = 2 + objLength;
      }
    });
  
    if (currentChunk.length > 0) {
      result.push(currentChunk);
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
  wait
};
