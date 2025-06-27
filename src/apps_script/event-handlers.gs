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
