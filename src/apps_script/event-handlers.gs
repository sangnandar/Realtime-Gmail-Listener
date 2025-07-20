/*******************************************************
 **               TRIGGER/EVENT HANDLERS              **
 *******************************************************/

/**
 * POST handler for task "processNewEmails".
 * 
 * @param {object} data - The data object from POST.
 * @returns {object} JSON response.
 */
function processNewEmails(data)
{
  const requiredFields = [
    'emailAddress',
    'historyId'
  ];
  if (!isObject(data) || !requiredFields.every(field => Object.prototype.hasOwnProperty.call(data, field))) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      message: MESSAGES.invalidData
    })).setMimeType(ContentService.MimeType.JSON);
  }

  const historyId = SCRIPT_PROPS.getProperty('lastHistoryId') || data.historyId;
  const emails = pullEmailsSince(historyId);

  if (!emails) {
    return {
      success: false,
      message: MESSAGES.noHistory
    }
  }

  if (!emails.length) {
    return {
      success: true,
      message: MESSAGES.noProcess
    };
  }

  const sheet = SS.getSheetByName(SHEETNAME_EMAILS);
  const dataMap = new SheetLayout(sheet).getDataMap();
  const lastRow = sheet.getLastRow();

  const values = emails.map(email => ({
    date: new Date(getHeader(email, 'Date')),
    from: getHeader(email, 'From'),
    subject: getHeader(email, 'Subject')
  }));

  // Update sheet
  sheet.getRange(lastRow + 1, dataMap.emailDate, values.length, Object.keys(values[0]).length).setValues(
    values.map(v => [v.date, v.from, v.subject])
  );

  let message = '';
  values.forEach(v => {
    message += `Date: ${v.date}\nFrom: ${v.from}\nSubject: ${v.subject}\n\n`;
  });

  // Send Telegram notification
  const token = getSecret('TELEGRAM_BOT_TOKEN');
  const chatId = getSecret('TELEGRAM_CHAT_ID');
  sendTelegramMessage(token, chatId, message);

  // Send Slack notification
  const url = getSecret('SLACK_API_URL');
  sendSlackMessage(url, message);

  return {
    success: true,
    message: MESSAGES.processSuccess
  };
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
    let response;
    try {
      response = Gmail.Users.History.list('me', {
        startHistoryId: historyId,
        pageToken: pageToken,
        historyTypes: ['messageAdded']
      });
    } catch (err) {
      const timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
      appendToLogFile(`${timestamp}: Failed to retrieve history list: ${err.message}`);
      return null;
    }

    const history = response.history || [];
    for (const record of history) {
      const added = record.messages || [];
      for (const msg of added) {
        try {
          const email = Gmail.Users.Messages.get('me', msg.id);
          emails.push(email);
        } catch (err) {
          // Log and skip messages that no longer exist
          // console.warn(`Skipping message ${msg.id}: ${err.message}`);
          const timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
          appendToLogFile(`${timestamp}: Skipping message ${msg.id}: ${err.message}`);
        }
      }
    }

    if (response.historyId) lastHistoryId = response.historyId;
    pageToken = response.nextPageToken;

  } while (pageToken);

  SCRIPT_PROPS.setProperty('lastHistoryId', lastHistoryId);

  return emails;
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

  if (UI) {
    UI
      .createMenu('Custom Menu')
        .addItem('Stop listening', 'stopWatch')
      .addToUi();
  }
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

  if (UI) {
    UI
      .createMenu('Custom Menu')
        .addItem('Start listening', 'initWatch')
      .addToUi();
  }
}

