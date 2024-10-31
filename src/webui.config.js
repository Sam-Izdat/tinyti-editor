// Note: __APP_NAME__, __APP_VERSION__ and __BUILD_TYPE__ are provided by vite config

// URL
export const APP_HOST_PATH = 'https://sam-izdat.github.io/tinyti-editor/';
export const APP_BASE_PATH = '/tinyti-editor';

export const cfg = {
  APP_HOST_PATH,
  APP_BASE_PATH,

  // GENERAL
  //------------------
  APP_TITLE:        'tinyti editor',
  APP_SHORT_NAME:   'tteditor',
  APP_DESCRIPTION:  'A web-based, client-side code editor for taichi.js (tinyti.js fork)',  
  APP_THEME:        'rocket', // skeleton UI theme

  // LOGGING
  //------------------
  LOG_LEVEL_DEV:     'DEBUG',
  LOG_LEVEL_PROD:    'ERROR',
  TRACE_LEVEL_DEV:   'ERROR',
  TRACE_LEVEL_PROD:  'CRITICAL',

  // PWA
  //------------------
  PWA_START_URL:     APP_HOST_PATH,
  PWA_SCOPE:         APP_HOST_PATH,
  PWA_FILE_EXT:      '.tinyti',
  PWA_FILE_MIME_TYPE:'application/x-tinyti',
  PWA_FILE_ACTION:   APP_HOST_PATH + 'open-file',
  PWA_URL_PATTERN:   'tinyti://*',
  PWA_THEME_COLOR:   '#3B4762', // theme color for app status/title bars etc
  PWA_BG_COLOR:      '#3B4762', // splash screen background
  PWA_ORIENTATION:   'any',     // setting 'landscape' will force PWA into landscape mode at all times

  // MISC OPTIONS
  //------------------

  // IndexedDB database name
  IDB_DB_NAME:        'TinytiEditorStorage',

  // IndexedDB store name for script/document sessions
  IDB_DOC_STORE_NAME: 'docsessions',

  // IndexedDB store name for archive screenshots/thumbnails
  IDB_THUMBNAIL_NAME: 'docthumbs',

  // LocalStorage prefix
  LS_PREFIX:          'tt-script-',

  // the programming language monaco editor should use
  EDITOR_LANGUAGE:    'javascript',

  // attempt to guess at "raw" URLs if given an HTML page address to import
  GUESS_RAW_URL:      true,

  // start mobile clients in 'read-only' mode (prevent keyboard from popping up until user enables editing)
  MOBILE_READONLY:    true,

  // delay before auto-build fires in ms (so we're not spamming build requests with every keystroke)
  AUTOBUILD_DELAY:    500,

  // duration of flash on editor screen when build succeeds/fails in ms
  BUILD_FLASH_DUR:    180,

  // color to flash editor on build success (dark and light mode respectively)
  BUILD_COL_SUCCESS:  ['rgba(0, 255, 0, 0.1)', 'rgba(0, 255, 0, 0.5)'],

  // color to flash editor on build failure (dark and light mode respectively)
  BUILD_COL_FAILURE:  ['rgba(255, 0, 0, 0.1)', 'rgba(255, 0, 0, 0.5)'],
};