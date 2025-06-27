/**
 * Custom menu to enable/disable Gmail Listener.
 * 
 * @returns {void}
 */
function onOpen()
{
  const menu = UI.createMenu('Custom Menu');

  const IsWatch = (SCRIPT_PROPS.getProperty('IsWatch') === 'true');
  if (IsWatch) menu.addItem('Stop listening', 'stopWatch');
  else menu.addItem('Start listening', 'initWatch');
  
  menu.addToUi();
}

/**
 * Handles POST requests to the web app.
 * 
 * @param {GoogleAppsScript.Events.AppsScriptHttpRequestEvent} e - Event object.
 * @returns {GoogleAppsScript.Content.TextOutput} JSON.
 */
function doPost(e)
{
  console.log('doPost called with data:', e.postData.contents);
  const body = JSON.parse(e.postData.contents);

  if (body.apiKey !== getSecret(APIKEY_STORE_KEY)) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      message: MESSAGES.invalidApiKey
    })).setMimeType(ContentService.MimeType.JSON);
  }

  if (!isFunction(API_HANDLERS[body.task])) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      message: MESSAGES.invalidTask
    })).setMimeType(ContentService.MimeType.JSON);
  }

  const response = API_HANDLERS[body.task](body.data);
  console.log('Response from handler:', response);  
  return ContentService.createTextOutput(JSON.stringify(response)).setMimeType(ContentService.MimeType.JSON);
}
