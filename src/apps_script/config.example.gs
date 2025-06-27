/*******************************************************
 **        GLOBAL VARIABLES AND CONFIGURATIONS        **
 *******************************************************/

/*
 * Rename this file to config.gs
 * and replace the placeholder values
 * with your actual values.
 */

const DEBUG = true; // set to false for production

var UI; // return null if called from script editor
try {
  UI = SpreadsheetApp.getUi();
} catch (e) {
  Logger.log('You are using script editor.');
}
const SS = SpreadsheetApp.getActiveSpreadsheet();
const SCRIPT_PROPS = PropertiesService.getScriptProperties();


// === START: Configuration for Sheets ===

// Sheet: 'Emails'
const SHEETNAME_EMAILS = DEBUG
  ? 'Emails_dev' // for development & debugging
  : 'Emails'; // for production

// Sheet: <add more sheets...>

const SHEETCONFIG = readOnlyObject({

  [SHEETNAME_EMAILS]: {
    layout: {
      headerRows: 1,
      variableNames: {
        emailDate           : { col: 'A', type: 'date'   },
        emailFrom           : { col: 'B', type: 'string' },
        emailSubject        : { col: 'C', type: 'string' }
      }
    },
    /** @type {Array<EditRule>} */
    onEditRules: []
  }
  // <add more sheets...>
});

// === END: Configuration for Sheets ===


// === START: Configuration for GCP Project ===
const PROJECT_ID = 'YOUR_PROJECT_ID';
const PUBSUB_TOPIC = 'gmail-push-proxy-pubsub';
// === END: Configuration for GCP Project ===

// === START: Configuration for HTTP Requests ===
const APIKEY_STORE_KEY = 'PUSH_PROXY_GAS_API_KEY';
const API_HANDLERS = {
  processNewEmails
};
// === END: Configuration for HTTP Requests ===

const MESSAGES = readOnlyObject({
  configError: `There is a problem with the configuration. Please contact the developer.`,
  noProcess: `No new email to process.`,
  processSuccess: `Data processed successfully.`,
  invalidApiKey: `API key is invalid!`,
  invalidTask: `Task name is invalid!`,
  invalidData: `Data is invalid or missing required properties!`
});


/**
 * A generic rule for handling various Google Apps Script events.
 *
 * @template T
 * @typedef {Object} Rule
 * @property {(e: T, layout?: SheetLayout) => boolean} condition
 * @property {(e: T, layout?: SheetLayout) => void} handler
 */

/**
 * Specific rule typedefs.
 * 
 * @typedef {Rule<GoogleAppsScript.Events.SheetsOnEdit>} EditRule
 * @typedef {Rule<GoogleAppsScript.Events.SheetsOnChange>} ChangeRule
 * @typedef {Rule<GoogleAppsScript.Events.SheetsOnOpen>} OpenRule
 */

