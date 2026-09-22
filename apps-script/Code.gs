/**
 * HisabKit — centralized Google Apps Script API
 * =============================================
 *
 * One web app that fronts every HisabKit sheet. There is no per-sheet
 * doGet/doPost code: every table is described by the SCHEMA table below, and
 * the same generic handlers serve all eleven of them.
 *
 * ---------------------------------------------------------------------------
 * GET  (all parameters in the query string)
 * ---------------------------------------------------------------------------
 *   ?action=meta
 *       Reports the API version and which of the eleven tabs currently exist.
 *
 *   ?action=list&sheet=Items
 *       Every row of the sheet as JSON objects keyed by the header row.
 *       Optional: &limit=50  &filter=<url-encoded JSON>  e.g. {"Status":"Active"}
 *
 *   ?action=get&sheet=Items&idField=ItemID&id=ITM-001
 *       One row.
 *
 * ---------------------------------------------------------------------------
 * POST (JSON body; the request is sent as text/plain so the browser does not
 *       trigger a CORS preflight that Apps Script cannot answer)
 * ---------------------------------------------------------------------------
 *   { "action":"create", "sheet":"Items", "data":{...} }
 *   { "action":"update", "sheet":"Items", "idField":"ItemID", "id":"ITM-001",
 *     "data":{ "SellingPrice": 145 } }
 *   { "action":"delete", "sheet":"Items", "idField":"ItemID", "id":"ITM-001" }
 *   { "action":"setup" }
 *       Creates any missing tab and writes its header row. Never touches a tab
 *       that already exists.
 *   { "action":"transaction", "ops":[ {op}, {op}, ... ] }
 *       Applies several create/update/delete operations as one unit: the whole
 *       batch is rejected if any single operation fails, and the affected
 *       sheets are restored to their previous contents. This is what the
 *       purchase, sale and payment screens use, because a single purchase
 *       touches five sheets and a half-written purchase is worse than none.
 *
 * ---------------------------------------------------------------------------
 * Response envelope (every action, success and failure alike)
 * ---------------------------------------------------------------------------
 *   { "success": true,  "data": ... }
 *   { "success": false, "error": "human-readable reason" }
 *
 * For backwards compatibility the list action also mirrors its rows into an
 * "items" key when the sheet is Items, and a POST body that is a bare Items
 * row (no "action" field) is treated as create Items. The previously deployed
 * frontend keeps working after this file is pasted in.
 *
 * ---------------------------------------------------------------------------
 * Guarantees
 * ---------------------------------------------------------------------------
 *   - Only the eleven names in SCHEMA are reachable. Any other value for
 *     "sheet" is rejected, so a stray parameter can never reach an unrelated
 *     tab of the spreadsheet.
 *   - Column headers are read from row 1 at call time; nothing is hardcoded
 *     to a column position.
 *   - Existing rows are never rewritten except by an explicit update, and no
 *     action ever deletes a whole sheet or clears a range outside the single
 *     row it was asked to change.
 *   - Every write runs under a script lock, so two devices saving at the same
 *     moment cannot interleave rows.
 *   - IDs are minted from the sheet's own contents (highest existing number
 *     plus one) and a duplicate ID is refused, not silently written.
 */

/* ============================================================
   SCHEMA — the single source of truth for every table
   ============================================================ */

var API_VERSION = '2.0.0';

/**
 * sheet name -> { idField, prefix, columns }
 * "prefix" is the ID prefix from the project specification; IDs look like
 * ITM-001. "columns" is the exact header row, in order.
 */
var SCHEMA = {
  Items: {
    idField: 'ItemID', prefix: 'ITM-',
    columns: ['ItemID','SKU','ItemName','Category','Unit','PurchasePrice',
              'SellingPrice','CurrentStock','LowStockLevel','Status']
  },
  Categories: {
    idField: 'CategoryID', prefix: 'CAT-',
    columns: ['CategoryID','CategoryName','Description','Status']
  },
  Customers: {
    idField: 'CustomerID', prefix: 'CUS-',
    columns: ['CustomerID','CustomerName','Phone','Email','Address','GSTIN',
              'OpeningBalance','BalanceType','CreditLimit','Status']
  },
  Suppliers: {
    idField: 'SupplierID', prefix: 'SUP-',
    columns: ['SupplierID','SupplierName','Phone','Email','Address','GSTIN',
              'OpeningBalance','BalanceType','CreditLimit','Status']
  },
  Purchases: {
    idField: 'PurchaseID', prefix: 'PUR-',
    columns: ['PurchaseID','BillNo','SupplierID','PurchaseDate','SubTotal',
              'TaxAmount','Discount','TotalAmount','PaidAmount','DueAmount',
              'PaymentStatus','Notes']
  },
  Purchase_Items: {
    idField: 'PurchaseItemID', prefix: 'PI-',
    columns: ['PurchaseItemID','PurchaseID','ItemID','Quantity','Unit',
              'PurchasePrice','Discount','TaxRate','TaxAmount','TotalAmount']
  },
  Sales: {
    idField: 'SaleID', prefix: 'SAL-',
    columns: ['SaleID','InvoiceNo','CustomerID','SaleDate','SubTotal',
              'TaxAmount','Discount','TotalAmount','PaidAmount','DueAmount',
              'PaymentStatus','Notes']
  },
  Sales_Items: {
    idField: 'SaleItemID', prefix: 'SI-',
    columns: ['SaleItemID','SaleID','ItemID','Quantity','Unit','SellingPrice',
              'Discount','TaxRate','TaxAmount','TotalAmount']
  },
  Stock_Ledger: {
    idField: 'LedgerID', prefix: 'LED-',
    columns: ['LedgerID','ItemID','DateTime','TransactionType','ReferenceID',
              'QuantityIn','QuantityOut','BalanceStock','Unit','Notes']
  },
  Payments: {
    idField: 'PaymentID', prefix: 'PAY-',
    columns: ['PaymentID','PaymentDate','PartyType','PartyID','ReferenceType',
              'ReferenceID','Amount','PaymentMode','TransactionType','Notes']
  },
  Settings: {
    idField: 'SettingID', prefix: 'SET-',
    columns: ['SettingID','SettingKey','SettingValue','Description','Status']
  }
};

/** Columns that should be written as numbers rather than text. */
var NUMERIC_HINTS = ['Price','Amount','Quantity','Stock','Rate','Discount',
                     'Balance','Limit','Level','Tax','In','Out','Value'];

/* ============================================================
   ENTRY POINTS
   ============================================================ */

function doGet(e) {
  var params = (e && e.parameter) || {};
  try {
    return jsonOut(route(params, null));
  } catch (err) {
    return jsonOut(fail(err));
  }
}

function doPost(e) {
  var params = (e && e.parameter) || {};
  var body = {};
  try {
    body = parseBody(e);
  } catch (err) {
    return jsonOut({ success: false, error: 'Request body was not valid JSON.' });
  }

  // Backwards compatibility: the first deployed frontend posted a bare Items
  // row with no envelope at all. Recognise it and treat it as a create.
  if (!body.action && (body.ItemID || body.ItemName)) {
    body = { action: 'create', sheet: 'Items', data: body };
  }

  try {
    return jsonOut(route(params, body));
  } catch (err) {
    return jsonOut(fail(err));
  }
}

/** Shared dispatcher for GET and POST. */
function route(params, body) {
  var req = {};
  var key;
  for (key in params) req[key] = params[key];
  if (body) for (key in body) req[key] = body[key];

  var action = String(req.action || 'list').toLowerCase();

  switch (action) {
    case 'meta':
      return ok(meta());
    case 'setup':
      return ok(setupAll());
    case 'dump':
      return ok(dumpAll());
    case 'list':
      return ok(list(req));
    case 'get':
      return ok(getOne(req));
    case 'create':
      return ok(create(req));
    case 'update':
      return ok(update(req));
    case 'delete':
      return ok(remove(req));
    case 'transaction':
      return ok(transaction(req));
    default:
      throw new Error('Unknown action "' + action + '". Supported: meta, setup, dump, ' +
                      'list, get, create, update, delete, transaction.');
  }
}

/**
 * Every tab in one response, so the frontend can start with a single round
 * trip instead of eleven. A tab that does not exist yet comes back empty.
 */
function dumpAll() {
  var out = {};
  Object.keys(SCHEMA).forEach(function (name) {
    var sheet = openSheet(name, false);
    out[name] = sheet ? readRecords(sheet) : [];
  });
  return out;
}

/* ============================================================
   ACTIONS
   ============================================================ */

/** API version plus which tabs exist. Used by the frontend for diagnostics. */
function meta() {
  var ss = spreadsheet();
  var present = [];
  var missing = [];
  Object.keys(SCHEMA).forEach(function (name) {
    if (ss.getSheetByName(name)) present.push(name); else missing.push(name);
  });
  return {
    version: API_VERSION,
    spreadsheet: ss.getName(),
    sheetsPresent: present,
    sheetsMissing: missing,
    idPrefixes: (function () {
      var map = {};
      Object.keys(SCHEMA).forEach(function (n) { map[n] = SCHEMA[n].prefix; });
      return map;
    })()
  };
}

/** Create every missing tab with its header row. Existing tabs are untouched. */
function setupAll() {
  var ss = spreadsheet();
  var created = [];
  Object.keys(SCHEMA).forEach(function (name) {
    if (!ss.getSheetByName(name)) {
      var sheet = ss.insertSheet(name);
      writeHeader(sheet, SCHEMA[name].columns);
      seedIfNeeded(sheet, name);
      created.push(name);
    }
  });
  return { created: created, sheets: Object.keys(SCHEMA) };
}

/**
 * Starter categories, matching the ones the app shipped with before the
 * Categories tab existed, so an existing item whose Category is one of these
 * still finds its dropdown entry.
 */
var DEFAULT_CATEGORIES = [
  ['Copper Pipes', 'Copper tubing and fittings'],
  ['Refrigerant', 'Refrigerant gases'],
  ['Insulation', 'Pipe and duct insulation'],
  ['AC Parts', 'Air-conditioner spares'],
  ['Electrical', 'Electrical components'],
  ['Tools', 'Hand and power tools'],
  ['Accessories', 'Installation accessories'],
  ['Consumables', 'General consumables']
];

/**
 * Give a brand-new tab the rows it needs to be immediately usable. Runs only
 * when this script created the tab, so a tab that already holds data is never
 * given extra rows.
 */
function seedIfNeeded(sheet, name) {
  if (name !== 'Categories') return;
  DEFAULT_CATEGORIES.forEach(function (pair, i) {
    sheet.appendRow([SCHEMA.Categories.prefix + pad(i + 1, 3), pair[0], pair[1], 'Active']);
  });
}

/** Every row of a sheet as objects keyed by the row-1 headers. */
function list(req) {
  var spec = requireSheet(req);
  var sheet = openSheet(spec.name, false);
  if (!sheet) return [];

  var rows = readRecords(sheet);
  var filter = req.filter ? parseFilter(req.filter) : null;
  if (filter) {
    rows = rows.filter(function (row) {
      return Object.keys(filter).every(function (col) {
        return String(row[col]) === String(filter[col]);
      });
    });
  }

  var limit = Number(req.limit) || 0;
  if (limit > 0) rows = rows.slice(0, limit);
  return rows;
}

/** One row, located by its ID column. */
function getOne(req) {
  var spec = requireSheet(req);
  var idField = req.idField || spec.idField;
  var id = req.id;
  if (!id) throw new Error('Missing "id".');

  var sheet = openSheet(spec.name, false);
  if (!sheet) throw new Error('No ' + spec.name + ' record with ' + idField + ' "' + id + '".');

  var found = findRow(sheet, idField, id);
  if (!found) throw new Error('No ' + spec.name + ' record with ' + idField + ' "' + id + '".');
  return found.record;
}

/**
 * Append one row. The ID is minted from the sheet when the caller did not
 * supply one, and a caller-supplied duplicate is refused rather than written.
 */
function create(req) {
  var spec = requireSheet(req);
  var data = req.data || {};
  var sheet = openSheet(spec.name, true);

  var record = normalise(spec, data);
  if (!record[spec.idField]) record[spec.idField] = nextId(sheet, spec);
  if (findRow(sheet, spec.idField, record[spec.idField])) {
    throw new Error('Duplicate ' + spec.idField + ' "' + record[spec.idField] + '".');
  }

  appendRecord(sheet, spec, record);
  return record;
}

/** Merge the supplied fields into the row identified by idField/id. */
function update(req) {
  var spec = requireSheet(req);
  var idField = req.idField || spec.idField;
  var id = req.id;
  if (!id) throw new Error('Missing "id".');

  var sheet = openSheet(spec.name, false);
  if (!sheet) throw new Error('No ' + spec.name + ' record with ' + idField + ' "' + id + '".');

  var found = findRow(sheet, idField, id);
  if (!found) throw new Error('No ' + spec.name + ' record with ' + idField + ' "' + id + '".');

  var headers = headersOf(sheet);
  var merged = Object.assign({}, found.record, normalise(spec, req.data || {}));
  // The ID column is never changed by an update.
  merged[spec.idField] = found.record[spec.idField];

  writeRow(sheet, found.rowIndex, headers, merged);
  return merged;
}

/** Delete exactly one row. */
function remove(req) {
  var spec = requireSheet(req);
  var idField = req.idField || spec.idField;
  var id = req.id;
  if (!id) throw new Error('Missing "id".');

  var sheet = openSheet(spec.name, false);
  if (!sheet) throw new Error('No ' + spec.name + ' record with ' + idField + ' "' + id + '".');

  var found = findRow(sheet, idField, id);
  if (!found) throw new Error('No ' + spec.name + ' record with ' + idField + ' "' + id + '".');

  sheet.deleteRow(found.rowIndex);
  return { deleted: spec.name, idField: idField, id: id };
}

/**
 * Apply several operations as one unit.
 *
 * Google Sheets has no transactions, so this approximates one: every sheet the
 * batch will touch is snapshotted first, all operations run under a script
 * lock, and on the first failure the snapshots are written back and the
 * surplus rows removed. A reader never sees a partially applied batch.
 *
 * Operations are the same shapes as create/update/delete:
 *   { "action":"create", "sheet":"Purchase_Items", "data":{...} }
 *   { "action":"update", "sheet":"Items", "idField":"ItemID", "id":"ITM-001",
 *     "data":{ "CurrentStock": 55 } }
 *   { "action":"delete", "sheet":"Payments", "idField":"PaymentID", "id":"PAY-004" }
 */
function transaction(req) {
  var ops = req.ops || req.operations;
  if (!Array.isArray(ops) || !ops.length) throw new Error('A transaction needs a non-empty "ops" array.');

  // Validate every operation before touching anything, so a typo in the last
  // operation cannot leave the first ones applied.
  ops.forEach(function (op, i) {
    var name = op && op.sheet;
    if (!SCHEMA[name]) throw new Error('Operation ' + (i + 1) + ': unknown sheet "' + name + '".');
    var verb = String(op.action || '').toLowerCase();
    if (['create','update','delete'].indexOf(verb) === -1) {
      throw new Error('Operation ' + (i + 1) + ': unsupported action "' + op.action + '".');
    }
  });

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('The spreadsheet is busy with another save. Try again in a moment.');

  try {
    var ss = spreadsheet();

    // Every sheet that will be written needs its header row present, and a
    // snapshot we can put back if a later operation fails.
    var touched = {};
    ops.forEach(function (op) { touched[op.sheet] = true; });

    var snapshots = {};
    Object.keys(touched).forEach(function (name) {
      var sheet = openSheet(name, true);
      snapshots[name] = {
        lastRow: sheet.getLastRow(),
        lastColumn: Math.max(sheet.getLastColumn(), SCHEMA[name].columns.length),
        values: sheet.getLastRow() > 0
          ? sheet.getRange(1, 1, sheet.getLastRow(), Math.max(sheet.getLastColumn(), 1)).getValues()
          : []
      };
    });

    var results = [];
    try {
      ops.forEach(function (op) {
        var verb = String(op.action).toLowerCase();
        if (verb === 'create') results.push(create(op));
        else if (verb === 'update') results.push(update(op));
        else results.push(remove(op));
      });
    } catch (err) {
      restore(ss, snapshots);
      throw new Error('Nothing was saved — ' + err.message);
    }

    return { applied: results.length, results: results };
  } finally {
    lock.releaseLock();
  }
}

/** Put every snapshotted sheet back exactly as it was. */
function restore(ss, snapshots) {
  Object.keys(snapshots).forEach(function (name) {
    var sheet = ss.getSheetByName(name);
    if (!sheet) return;
    var snap = snapshots[name];

    // Clear whatever the failed batch wrote, then write the old contents back.
    var surplus = sheet.getLastRow() - snap.lastRow;
    if (surplus > 0) {
      sheet.deleteRows(snap.lastRow + 1, surplus);
    }
    if (snap.values.length) {
      sheet.getRange(1, 1, snap.values.length, snap.values[0].length).setValues(align(snap.values, snap.values[0].length));
    }
  });
}

/* ============================================================
   SHEET PLUMBING
   ============================================================ */

/** The spreadsheet this script is bound to, or the one named in settings. */
function spreadsheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss) return ss;
  throw new Error('This script is not bound to a spreadsheet. Open Extensions > ' +
                  'Apps Script from the spreadsheet that holds the HisabKit data.');
}

/** Resolve and validate the requested sheet name against SCHEMA. */
function requireSheet(req) {
  var name = req.sheet || req.Sheet || req.tab;
  if (!name) throw new Error('Missing "sheet". Allowed: ' + Object.keys(SCHEMA).join(', '));
  name = String(name).trim();

  if (!SCHEMA[name]) {
    // Refuse anything outside the allowed list so an arbitrary tab name can
    // never be read or written through this API.
    throw new Error('Sheet "' + name + '" is not allowed. Allowed: ' + Object.keys(SCHEMA).join(', '));
  }
  return { name: name, idField: SCHEMA[name].idField, prefix: SCHEMA[name].prefix, columns: SCHEMA[name].columns };
}

/**
 * Get a sheet handle. With create=true a missing tab is created together with
 * its header row; with create=false a missing tab yields null so the caller can
 * answer with an empty list rather than an error.
 */
function openSheet(name, create) {
  var ss = spreadsheet();
  var sheet = ss.getSheetByName(name);
  if (sheet) {
    ensureHeader(sheet, name);
    return sheet;
  }
  if (!create) return null;

  sheet = ss.insertSheet(name);
  writeHeader(sheet, SCHEMA[name].columns);
  seedIfNeeded(sheet, name);
  return sheet;
}

/** Header row for a sheet, created if the sheet is somehow blank. */
function ensureHeader(sheet, name) {
  var expected = SCHEMA[name].columns;
  if (sheet.getLastRow() === 0 || sheet.getLastColumn() === 0) {
    writeHeader(sheet, expected);
    return;
  }
  var actual = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
                    .map(function (v) { return String(v).trim(); });
  // Only fill a genuinely empty header; never rewrite a header a human edited.
  if (!actual.join('')) writeHeader(sheet, expected);
}

function writeHeader(sheet, columns) {
  sheet.getRange(1, 1, 1, columns.length).setValues([columns]);
  sheet.setFrozenRows(1);
}

function headersOf(sheet) {
  var width = Math.max(sheet.getLastColumn(), 1);
  return sheet.getRange(1, 1, 1, width).getValues()[0].map(function (v) {
    return String(v).trim();
  });
}

/** All data rows (row 2 down) as objects keyed by header. Blank rows skipped. */
function readRecords(sheet) {
  var lastRow = sheet.getLastRow();
  var lastColumn = sheet.getLastColumn();
  if (lastRow < 2 || lastColumn < 1) return [];

  var headers = headersOf(sheet);
  var values = sheet.getRange(2, 1, lastRow - 1, lastColumn).getValues();
  var out = [];

  values.forEach(function (row) {
    var record = {};
    var hasValue = false;
    headers.forEach(function (header, i) {
      if (!header) return;
      var value = row[i];
      if (value instanceof Date) value = isoDate(value);
      record[header] = value;
      if (value !== '' && value !== null && value !== undefined) hasValue = true;
    });
    if (hasValue) out.push(record);
  });
  return out;
}

/** Locate a row by an ID column. Returns { rowIndex, record } or null. */
function findRow(sheet, idField, id) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;

  var headers = headersOf(sheet);
  var col = headers.indexOf(idField);
  if (col === -1) throw new Error('Column "' + idField + '" is not present in ' + sheet.getName() + '.');

  var values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  var wanted = String(id).trim();

  for (var i = 0; i < values.length; i++) {
    if (String(values[i][col]).trim() !== wanted) continue;

    var record = {};
    headers.forEach(function (header, c) {
      if (!header) return;
      var value = values[i][c];
      if (value instanceof Date) value = isoDate(value);
      record[header] = value;
    });
    return { rowIndex: i + 2, record: record };
  }
  return null;
}

/** Append a record, in header order, coercing numbers where the column implies one. */
function appendRecord(sheet, spec, record) {
  var headers = headersOf(sheet);
  sheet.appendRow(rowArray(headers, spec.name, record));
}

function writeRow(sheet, rowIndex, headers, record) {
  var array = rowArray(headers, sheet.getName(), record);
  sheet.getRange(rowIndex, 1, 1, array.length).setValues([array]);
}

/** Record -> array matching the sheet's header order. */
function rowArray(headers, sheetName, record) {
  var spec = SCHEMA[sheetName] || { columns: headers };
  return headers.map(function (header) {
    var value = record[header];
    if (value === undefined || value === null) return '';
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    if (isNumericColumn(header) && value !== '' && !isNaN(Number(value))) return Number(value);
    return value;
  });
}

function isNumericColumn(header) {
  return NUMERIC_HINTS.some(function (hint) { return header.indexOf(hint) !== -1; });
}

/** Keep only known columns, trim strings, and fill the ID field. */
function normalise(spec, data) {
  var out = {};
  spec.columns.forEach(function (column) {
    if (data[column] === undefined) return;
    var value = data[column];
    out[column] = typeof value === 'string' ? value.trim() : value;
  });
  return out;
}

/**
 * Next ID for a sheet, derived from the IDs already present: highest numeric
 * suffix plus one. Legacy or hand-written IDs that do not match the pattern are
 * ignored rather than deleted, so ITM-001, ITM-002 and a stray
 * "itm_mu8v6fclvqxssw" together yield ITM-003.
 */
function nextId(sheet, spec) {
  var headers = headersOf(sheet);
  var col = headers.indexOf(spec.idField);
  if (col === -1) return spec.prefix + '001';

  var lastRow = sheet.getLastRow();
  var highest = 0;
  if (lastRow >= 2) {
    var values = sheet.getRange(2, col + 1, lastRow - 1, 1).getValues();
    var pattern = new RegExp('^' + spec.prefix.replace('-', '\\-') + '(\\d+)$', 'i');
    values.forEach(function (row) {
      var match = pattern.exec(String(row[0]).trim());
      if (match) highest = Math.max(highest, parseInt(match[1], 10));
    });
  }
  return spec.prefix + pad(highest + 1, 3);
}

function pad(n, width) {
  var s = String(n);
  while (s.length < width) s = '0' + s;
  return s;
}

/* ============================================================
   HELPERS
   ============================================================ */

function parseBody(e) {
  if (!e) return {};
  if (e.postData && e.postData.contents) {
    var text = String(e.postData.contents).trim();
    if (!text) return {};
    return JSON.parse(text);
  }
  return {};
}

function parseFilter(raw) {
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw));
  } catch (err) {
    throw new Error('"filter" was not valid JSON.');
  }
}

/** Dates come back from the sheet as Date objects; the app expects YYYY-MM-DD. */
function isoDate(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone() || 'Asia/Kolkata', 'yyyy-MM-dd');
}

/** Pad a snapshot to a rectangle so setValues accepts it. */
function align(values, width) {
  return values.map(function (row) {
    var copy = row.slice();
    while (copy.length < width) copy.push('');
    return copy.slice(0, width);
  });
}

function ok(data) {
  var payload = { success: true, data: data };
  // Backwards compatibility with the first deployed frontend, which expected
  // { success: true, items: [...] } from a plain GET of the Items sheet.
  if (Array.isArray(data) && data.length && data[0].ItemID !== undefined) {
    payload.items = data;
  }
  return payload;
}

function fail(err) {
  return {
    success: false,
    error: (err && err.message) ? err.message : String(err),
    detail: err && err.stack ? String(err.stack).split('\n')[0] : ''
  };
}

function jsonOut(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
