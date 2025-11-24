// =====================================================
// 🔒 설정
// =====================================================
const ROOT_FOLDER_ID = ""; // 저장될 구글 드라이브 폴더ID
const SECRET_KEY = "";     // 접근 제한용 비밀키
// =====================================================

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    // 1. 보안 검사
    if (data.key !== SECRET_KEY) return createRes("error", "Unauthorized");

    // 2. 요청 분기 (라우팅)
    if (data.type === "init") return initResumableUpload(data);       // 업로드 시작
    if (data.type === "upload") return uploadChunk(data);             // 조각 전송
    if (data.type === "history_get") return handleHistoryGet(data);   // 기록 조회
    if (data.type === "history_save") return handleHistoryPost(data); // 기록 저장
    
    // (구버전 호환용: 혹시 몰라 남겨둠)
    if (data.fileData) return createRes("error", "Please use chunk upload (update script)");

    return createRes("error", "Unknown type");

  } catch (error) {
    return createRes("error", error.toString());
  }
}

// =======================================================
// 📂 기능 1: 이어 올리기 (Resumable Upload) - 핵심!
// =======================================================
function initResumableUpload(data) {
  const folderId = getFolderId(data.folderName); 
  const url = "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable";
  
  const metadata = {
    name: data.fileName,
    parents: [folderId],
    mimeType: "application/zip" // CBZ도 ZIP 기반
  };

  const params = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(metadata),
    headers: { "Authorization": "Bearer " + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(url, params);
  if (response.getResponseCode() === 200) {
    // 업로드 세션 URL 반환
    return createRes("success", response.getHeaders()["Location"]);
  } else {
    return createRes("error", response.getContentText());
  }
}

function uploadChunk(data) {
  const uploadUrl = data.uploadUrl;
  const chunkData = Utilities.base64Decode(data.chunkData);
  const start = data.start;
  const total = data.total;
  
  const blob = Utilities.newBlob(chunkData);
  const size = blob.getBytes().length;
  const end = start + size - 1;

  const rangeHeader = `bytes ${start}-${end}/${total}`;

  const params = {
    method: "put",
    payload: blob,
    headers: { "Content-Range": rangeHeader },
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(uploadUrl, params);
  const code = response.getResponseCode();

  // 308: 아직 덜 끝남(정상), 200/201: 완료(정상)
  if (code === 308 || code === 200 || code === 201) {
    return createRes("success", "Chunk uploaded");
  } else {
    return createRes("error", `Drive API Error: ${code}`);
  }
}

function getFolderId(folderName) {
  const root = DriveApp.getFolderById(ROOT_FOLDER_ID);
  const folders = root.getFoldersByName(folderName);
  if (folders.hasNext()) return folders.next().getId();
  else return root.createFolder(folderName).getId();
}

// =======================================================
// 📝 기능 2: 기록 관리 (기존 코드 유지)
// =======================================================
function handleHistoryGet(data) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const textFinder = sheet.getRange("A:A").createTextFinder(String(data.id)).matchEntireCell(true);
  const found = textFinder.findNext();
  if (found) {
    return createRes("success", sheet.getRange(found.getRow(), 3).getValue());
  }
  return createRes("success", "[]");
}

function handleHistoryPost(data) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const id = String(data.id);
  let textFinder = sheet.getRange("A:A").createTextFinder(id).matchEntireCell(true);
  let found = textFinder.findNext();
  let currentRow = found ? found.getRow() : sheet.getLastRow() + 1;

  if (!found) {
    sheet.getRange(currentRow, 1).setValue(id);
    sheet.getRange(currentRow, 2).setValue(data.title);
  } else {
    // 제목 업데이트 (선택)
    sheet.getRange(currentRow, 2).setValue(data.title);
  }
  
  let currentData = [];
  const cell = sheet.getRange(currentRow, 3);
  if (cell.getValue()) currentData = JSON.parse(cell.getValue());
  
  const merged = Array.from(new Set([...currentData, ...data.episodes])).sort((a,b)=>a-b);
  cell.setValue(JSON.stringify(merged));
  
  return createRes("success", "Updated");
}

function createRes(status, body) {
  return ContentService.createTextOutput(JSON.stringify({status: status, body: body})).setMimeType(ContentService.MimeType.JSON);
}
// ▼ 권한 승인용 함수 (Code.gs 맨 아래에 추가하세요)
function authorizeCheck() {
  // 1. 드라이브 접근 권한 요청
  DriveApp.getRootFolder();
  
  // 2. 스프레드시트 접근 권한 요청
  SpreadsheetApp.getActiveSpreadsheet();
  
  // 3. 외부 통신(UrlFetchApp) 권한 요청 (이게 이번에 추가된 핵심입니다)
  UrlFetchApp.fetch("https://www.google.com");
  
  console.log("✅ 모든 권한(Drive, Sheet, External)이 승인되었습니다!");
}
