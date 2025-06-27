/*******************************************************
 **       UTILITY AND HELPER CLASSES/FUNCTIONS        **
 *******************************************************/

 /**
 * A utility class for handling structured data access in a Google Sheets sheet.
 * 
 * This class wraps a GoogleAppsScript `Sheet` object and provides a structured way
 * to access header row information and named column mappings using a centralized config.
 * 
 * It relies on a global `SHEETCONFIG` object that maps sheet names to:
 * - `headerRows`: number of header rows
 * - `variableNames`: map of variable names to column letters and types
 */
class SheetLayout
{
  /**
   * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - The sheet to wrap.
   */
  constructor(sheet)
  {
    this.sheet = sheet;
    this.sheetName = sheet.getName();

    // Memoization
    this._dataMap = null;
  }

  /**
   * Get the number of header rows configured for the sheet.
   * Defaults to 0 if not specified in the config.
   * 
   * @returns {number} Number of header rows.
   */
  getHeaderRowCount()
  {
    const config = SHEETCONFIG[this.sheetName]?.layout;
    return config?.headerRows ?? 0;
  }

  /**
   * Get the data configuration object for the sheet.
   * Defaults to an empty object if not specified in the config.
   * 
   * @returns {Object<string, { col: string, type: string }>} Variable-name definitions.
   */
  getDataConfig()
  {
    const config = SHEETCONFIG[this.sheetName]?.layout;
    return config?.variableNames ?? {};
  }

  /**
   * Get a map of variable-names to column-indexes.
   * 
   * @returns {Object<string, number>} Variable-name to column-index.
   */
  getDataMap()
  {
    if (this._dataMap !== null) return this._dataMap;

    const dataConfig = this.getDataConfig();
    this._dataMap = Object.fromEntries(
      Object.entries(dataConfig).map(
        ([key, { col }]) => [
          key,
          col.toUpperCase()
            .split('') // Split into an array of characters
            .reduce((total, char) => 
              total * 26 + (char.charCodeAt(0) - 64) // Base-26 math
            , 0)
        ]
      )
    );
    return this._dataMap;
  }
}

/**
 * @param {string} message 
 * @returns {void}
 */
function showAlert(message)
{
  if (UI) {
    UI.alert(message);
  } else {
    Logger.log(message);
  }
}

/**
 * Deep freezes an object, making it read-only (including nested objects).
 * 
 * @param {object} obj - The object to freeze.
 * @returns {object} The deeply frozen object.
 */
function readOnlyObject(obj)
{
  Object.getOwnPropertyNames(obj).forEach((prop) => {
    const value = obj[prop];
    if (typeof value === 'object' && value !== null) {
      readOnlyObject(value); // recursively freeze nested objects
    }
  });

  return Object.freeze(obj);
}

/**
 * Verify that the variable is a function.
 * Exclude AsyncFunction and GeneratorFunction.
 * 
 * @param {function} func - The variable to check.
 * @returns {boolean}
 */
function isFunction(func)
{
  return Object.prototype.toString.call(func) === '[object Function]';
}

/**
 * Checks if the variable is a plain object (not null, not array, not function).
 * 
 * @param {*} obj - The variable to check.
 * @returns {boolean}
 * @example
 *   isObject({}); // true
 *   isObject([]); // false
 *   isObject(null); // false
 *   isObject(() => {}); // false
 */
function isObject(obj) {
  return Object.prototype.toString.call(obj) === '[object Object]';
}

/**
 * .watch() is expired at the given expiration time (in milliseconds UTC).
 * This installable trigger re-initiate a new .watch() 1 hour before that expiration time.
 * 
 * @param {GoogleAppsScript.Events.TimeDriven} e - Event object.
 * @returns {void}
 */
function initWatch(e)
{
  const resource = {
    topicName: `projects/${PROJECT_ID}/topics/${PUBSUB_TOPIC}`,
    labelIds: ['INBOX'],
  };
  const response = Gmail.Users.watch(resource, 'me');

  // Schedule re-init 1 hour before expiration
  const expiration = Number(response.expiration); // milliseconds UTC
  const reinitAt = expiration - 60 * 60 * 1000; // 1 hour before

  scheduleAnotherRunAt('initWatch', reinitAt);

  if (e && e.triggerUid) { // safeguard against manual-run either from editor, custom-menu, or button
    deleteTriggerByUid(e.triggerUid); // this instance of trigger
  }

  SCRIPT_PROPS.setProperty('IsWatch', 'true');
  UI
    .createMenu('Custom Menu')
      .addItem('Stop listening', 'stopWatch')
    .addToUi();
}

/**
 * Stop the current .watch().
 * 
 * @returns {void}
 */
function stopWatch()
{
  Gmail.Users.stop('me');

  const funcName = 'initWatch';
  const trigger = ScriptApp.getProjectTriggers().find(t => t.getHandlerFunction() === funcName);
  if (trigger) ScriptApp.deleteTrigger(trigger);

  SCRIPT_PROPS.setProperty('IsWatch', 'false');
  SCRIPT_PROPS.deleteProperty('lastHistoryId');
  UI
    .createMenu('Custom Menu')
      .addItem('Start listening', 'initWatch')
    .addToUi();
}

/**
 * Schedule another run of a function at T timestamp.
 * 
 * @param {string} functionName - The name of the function to be triggered.
 * @param {number} T - Timestamp at which the function should be triggered.
 * @returns {void}
 */
function scheduleAnotherRunAt(functionName, T)
{
  ScriptApp.newTrigger(functionName)
    .timeBased()
    .at(new Date(T))
    .create();
}

/**
 * Clean up programmatically created triggers after use.
 * 
 * @param {string} uid - Unique ID of the trigger to be deleted.
 * @returns {void}
 */
function deleteTriggerByUid(uid)
{
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    if (trigger.getUniqueId() === uid) {
      ScriptApp.deleteTrigger(trigger);
      break;
    }
  }
}

/**
 * Pull all Gmail messages arrived since the given `historyId`.
 * 
 * @param {string} historyId - The Gmail history ID to start from.
 * @returns {object[]} The array of Gmail message objects.
 */
function pullEmailsSince(historyId)
{
  let pageToken = null;
  let lastHistoryId = historyId;
  const emails = [];

  do {
    const response = Gmail.Users.History.list('me', {
      startHistoryId: historyId,
      pageToken: pageToken,
      historyTypes: ['messageAdded']
    });

    const history = response.history || [];
    for (const record of history) {
      const added = record.messages || [];
      for (const msg of added) {
        const email = Gmail.Users.Messages.get('me', msg.id);
        emails.push(email);
      }
    }

    if (response.historyId) lastHistoryId = response.historyId;
    pageToken = response.nextPageToken;

  } while (pageToken);

  SCRIPT_PROPS.setProperty('lastHistoryId', lastHistoryId);

  return emails;
}

/**
 * Get a specific header value from a message.
 * 
 * @param {object} message - The Gmail message object.
 * @param {string} headerName - The header name (e.g., "Subject").
 * @returns {string} The header value or empty string.
 */
function getHeader(message, headerName)
{
  const headers = message.payload.headers || [];
  const match = headers.find(header => header.name.toLowerCase() === headerName.toLowerCase());
  return match ? match.value : '';
}

/**
 * Gets a secret from Google Secret Manager.
 * 
 * @param {string} secretName - The name of the secret
 * @returns {string} The secret value
 */
function getSecret(secretName)
{
  const version = 'latest';
  const url = `https://secretmanager.googleapis.com/v1/projects/${PROJECT_ID}/secrets/${secretName}/versions/${version}:access`;

  const response = UrlFetchApp.fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${ScriptApp.getOAuthToken()}`
    },
    muteHttpExceptions: true
  });

  const payload = JSON.parse(response.getContentText());
  const decoded = Utilities.base64Decode(payload.payload.data);
  return Utilities.newBlob(decoded).getDataAsString();
}

/**
 * Sends a message to a Telegram chat using a bot.
 *
 * @param {string} token - The Telegram bot token (from BotFather).
 * @param {string} chatId - The chat ID to send the message to.
 * @param {string} message - The message text to send.
 * @returns {void}
 */
function sendTelegramMessage(token, chatId, message)
{
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const options = {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    payload: JSON.stringify({
      chat_id: chatId,
      text: message
    })
  };

  const response = UrlFetchApp.fetch(url, options);
  const code = response.getResponseCode();
  if (code !== 200) {
    console.error(`Telegram error ${code}: ${response.getContentText()}`);
  }
}

/**
 * Sends a message to Slack using an incoming webhook URL.
 *
 * @param {string} url - The Slack webhook URL.
 * @param {string} message - The message text to send.
 * @returns {void}
 */
function sendSlackMessage(url, message)
{
  const options = {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    payload: JSON.stringify({
      text: message
    })
  };

  const response = UrlFetchApp.fetch(url, options);
  const code = response.getResponseCode();
  if (code !== 200) {
    console.error(`Slack error ${code}: ${response.getContentText()}`);
  }
}
