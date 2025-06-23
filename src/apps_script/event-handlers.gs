/*******************************************************
 **               TRIGGER/EVENT HANDLERS              **
 *******************************************************/

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

  const values = emails.map(email => [
    getHeader(email, 'Date'),
    getHeader(email, 'From'),
    getHeader(email, 'Subject')
  ]);
  sheet.getRange(lastRow + 1, dataMap.emailDate, values.length, values[0].length).setValues(values);

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
