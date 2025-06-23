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
  const body = JSON.parse(e.postData.contents);

  if (body.apiKey !== apiKey) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      message: MESSAGES.invalidApiKey
    })).setMimeType(ContentService.MimeType.JSON);
  }

  if (!isFunction(apiHandlers[body.task])) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      message: MESSAGES.invalidTask
    })).setMimeType(ContentService.MimeType.JSON);
  }

  const response = apiHandlers[body.task](body.data);
  return ContentService.createTextOutput(JSON.stringify(response)).setMimeType(ContentService.MimeType.JSON);
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
}
