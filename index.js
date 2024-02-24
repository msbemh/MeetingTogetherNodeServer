'use strict';

var os = require('os');
const fs = require('fs');
const path = require('path');
const multer  = require('multer');
const express = require('express');

// var http = require('http');
const https = require('https');
const socketIO = require('socket.io');

const PORT = process.env.PORT || 3030;

const get_SSL_options = function () {
  return {
    key: fs.readFileSync(path.resolve("/etc/letsencrypt/live/webrtc-sfu.kro.kr/privkey.pem")),
    cert: fs.readFileSync(path.resolve("/etc/letsencrypt/live/webrtc-sfu.kro.kr/fullchain.pem"))
  }
}

/**
 * 업로드 모듈(multer) 설정 시작
 */
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname, 'uploads'))
  },
  filename: function (req, file, cb) {
    const originalFileName = file.originalname.split('.')[0];
    const fileTypeExtension = file.originalname.split('.')[1];
    cb(null, `${originalFileName}-${Date.now()}.${fileTypeExtension}`);
  }
})
const upload = multer({ 
  storage: storage,
  // 여기서 timeout 설정
  onParseEnd: (req, next) => {
    // 30초로 타임 아웃 세팅
    req.connection.setTimeout(30 * 1000);
    next();
  },
});
// 업로드 모듈(multer) 설정 끝


const app = express();
const server = https.createServer(get_SSL_options(), app);

app.use('/static', express.static(path.join(__dirname, 'public')));

app.get('/test', (req, res) => {
  // res.sendFile(__dirname + "/index.html")
  res.send('hello');
});

/**
 * 이미지 프로필 업로드 Endpoint
 */
app.post('/profile', upload.single('avatar'), function (req, res, next) {
  console.log(`req: ${req}`);

  // req.file 은 `avatar` 라는 필드의 파일 정보입니다.
  console.log(`req.file:`, req.file);
  console.log(`req.body:`, req.body);

  res.status(200).send({
    message: "Ok",
    fileInfo: req.file
  });
});

/**
 * 이미지 프로필 업로드 Endpoint
 */
app.post('/photo', upload.single('photo'), function (req, res, next) {
  console.log(`req: ${req}`);

  // req.file 은 `photo` 라는 필드의 파일 정보입니다.
  console.log(`req.file:`, req.file);
  console.log(`req.body:`, req.body);

  res.status(200).send({
    message: "Ok",
    fileInfo: req.file
  });
});

/**
 * 미팅(WebRTC) 이미지 업로드 Endpoint
 */
app.post('/photos', upload.array('photos', 10), function (req, res, next) {
  console.log(`req: ${req}`);
  // req.file 은 `avatar` 라는 필드의 파일 정보입니다.
  console.log(`req.files:`, req.files);
  console.log(`req.body:`, req.body);
  // 텍스트 필드가 있는 경우, req.body가 이를 포함할 것입니다.
  // console.log(`${req.body}`);

  res.status(200).send({
    message: "Ok",
    fileInfos: req.files
  });
});

app.get('/', (req, res) => {
  res.sendFile(__dirname + "/index.html")
});

/**
 * Get Image
 */
app.get('/images/:imageName', (req, res) => {
  const imageName = req.params.imageName;
  res.sendFile(__dirname + '/uploads/' + imageName);
});

server.listen(PORT, function () {
  console.log(`Server is running... (PORT:${PORT})`);
});

/**
 * [연결된 소켓 관리]
 * Key : socket.id
 * Value : socket
 */
const connectedSockets = new Map();

/**
 * [화면 공유중인 소켓 관리]
 * Key : roomId
 * Value : Socket
 */
const screenSharingSockets = new Map();

/**
 * [화이트보드 공유중인 소켓관리]
 */
const whiteboardSockets = new Map();

const io = socketIO(server);
io.sockets.on('connection', function(socket) {

  var roomMaxClientNum = 5;
  
  socket.on('message', function(message) {
    let senderId = message.senderId;
    let targetId = message.targetId;

    // console.log(`[받은 메시지] senderId:${senderId}`);
    // console.log(`[받은 메시지] targetId:${targetId}`);

    // console.log(`[받은 메시지] message:`, message);

    // 스크린 공유중인 id 추가
    message.shareId = screenSharingSockets.get(socket.roomId);

    if(targetId){
      // console.log(`targetId 에게만 메시지를 보낸다.`);
      sendToTarget(message, targetId);
    }else{
      // console.log(`targetId 가 없으므로 모든 소켓에게 브로드캐스트`);
      socket.broadcast.emit('message', message);
    }
    
  });

  function sendToTarget(message, targetId){
    const targetSocket = getSocketAsClientId(targetId);
    if(!targetSocket){
      console.log(`${targetId} 소켓이 존재하지 않습니다.`);
      return;
    }
    targetSocket.emit('message', message);
  }

  socket.on('join', function(jsonString) {
    const jsonObject = JSON.parse(jsonString);

    var roomId = jsonObject.id;
    var user = jsonObject.user;
    var host = jsonObject.host;
    var userId = user.id;

    socket.userId = userId;

    

    user.clientId = socket.id;

    console.log(`${socket.id} 가 ${roomId}에 참가했습니다.`);

    if(isExistClient(socket.id)){
      console.log(`${socket.id} 는 이미 존재합니다.`);
      return;
    }

    var clientsInRoom = io.sockets.adapter.rooms.get(roomId);
    var numClients = clientsInRoom === undefined ? 0 : clientsInRoom.size;

    // 방은 최대 5명 까지
    if(roomMaxClientNum < numClients + 1){
      console.log(`방이 꽉차서 ${socket.id} 는 방에 참가할 수 없습니다.`);
      socket.emit('full');
      return;
    }

    // console.log(`socket ${socket.id} 가 연결 됐습니다.`);
    connectedSockets.set(socket.id, socket);

    // log('Received request to create or join room ' + roomId);

    // log('Room ' + roomId + ' now has ' + numClients + ' client(s)');

    socket.join(roomId);
    socket.roomId = roomId;
    socket.user = user;

    socket.user.isHost = false;
    if(host != null && host != undefined && socket.userId == host) {
      socket.user.isHost = true;
    }

    showConnectionSockets();

    const result = makeUserListSameRoomMsg(socket);

    io.sockets.in(roomId).emit('message', result);

  });

  /**
   * 호스트 이관
   */
  socket.on('host_change', function(jsonString) {
    const jsonObject = JSON.parse(jsonString);

    var roomId = jsonObject.id;
    var user = jsonObject.user;
    var host = jsonObject.host;
    var userId = user.id;

    console.log(`${userId} 에서 ${host} 로 호스트 변경이 요청 되었습니다.`);

    // host 만이 변경 요청을 할 수 있기 때문에 현재 socket.user 가 isHost true 이다 
    // isHost를 false 로 변경한다.
    socket.user.isHost = false;

    // 호스트로 임명할 사용자(host)를 socket.user 로 갖는 socket을 찾아서 isHost : true 로 변경 작업
    const socketToChange = getSocketAsUserId(host);
    socketToChange.user.isHost = true;

    // 해당 방 모든 소켓들에게 userList 정보를 전달한다.
    const result = makeUserListSameRoomMsg(socket);
    io.sockets.in(roomId).emit('host_change', result.userList);

  });

  socket.on('share', function(){
    const roomId = socket.roomId;
    const sharingSocketId = screenSharingSockets.get(roomId);

    const result = {
      type: 'share',
      shareId: sharingSocketId,
      shareStatus: undefined
    };

    /**
     * [shareStatus]
     * start : 클라이언트는 화면 공유를 시작한다.
     * stop : 클라이언트는 화면 공유를 중지시킨다.
     * ing : 다른 누군가가 이미 공유 중이기 떄문에 '이미 공유중' 메시지를 띄워준다.
     */
    // 아직 화면 공유중인 소켓 없음
    if(!sharingSocketId){
      screenSharingSockets.set(roomId, socket.id);
      result.shareId = socket.id;
      result.shareStatus = 'start';
      socket.emit('message', result);
    // 화면 공유중인 소켓 존재
    }else{
      // 화면 공유 중지
      if(sharingSocketId == socket.id){
        screenSharingSockets.delete(roomId);
        result.shareStatus = 'stop';
        io.sockets.in(roomId).emit('message', result);
      // 이미 화면 공유중 
      }else{
        result.shareStatus = 'ing';
        socket.emit('message', result);
      }
    }
    
  });

  socket.on('whiteboard', function(){
    const roomId = socket.roomId;
    if(isEmpty(roomId)) return;

    const whiteboardSocketId = whiteboardSockets.get(roomId);

    const result = {
      type: 'whiteboard',
      whiteboardId: whiteboardSocketId,
      whiteboardStatus: undefined
    };

    // 아직 화이트 보드 공유중인 소켓 없음
    if(!whiteboardSocketId){
      whiteboardSockets.set(roomId, socket.id);
      result.whiteboardId = socket.id;
      result.whiteboardStatus = 'start';
      io.sockets.in(roomId).emit('message', result);
  
    // 화이트 보드 공유중인 소켓 존재
    }else{
      // 화이트 보드 공유 중지
      if(whiteboardSocketId == socket.id){
        whiteboardSockets.delete(roomId);
        result.whiteboardStatus = 'stop';
        io.sockets.in(roomId).emit('message', result);
      // 이미 화이트보드 공유중 
      }else{
        result.whiteboardStatus = 'ing';
        socket.emit('message', result);
      }
    }
    
  });

  /**
   * [소켓연결 해제]
   * 소켓 관리 변수에서 해당 소켓 지우기
   * 같은 방 소켓들에게 나갔다라는 이벤트 전송
   * 
   * [클라이언트]
   * 피어 관리 변수에서 해당 피어 지우기
   * SurfaceViewRenderer 중지
   * SurfaceViewRenderer 레이아웃에서 삭제
   * SurfaceViewRenderer 관리 변수에서 삭제
   */
  socket.on('disconnect', function(){
    connectedSockets.delete(socket.id);
    console.log(`${socket.id}의 연결이 해제 됐습니다.`);

    const roomId = socket.roomId;

    let sharingSocketId = screenSharingSockets.get(roomId);
    if(socket.id == sharingSocketId) {
      screenSharingSockets.delete(roomId);
      sharingSocketId = undefined;
    }

    let whiteboardSocketId = whiteboardSockets.get(roomId);
    if(socket.id == whiteboardSocketId) {
      whiteboardSockets.delete(roomId);
      whiteboardSocketId = undefined;
    }

    sendMessageToSameRoomExceptMe('bye', socket, {
      id: socket.id,
      roomId: roomId,
      name: 'test',
      sharingSocketId: sharingSocketId,
      whiteboardSocketId: whiteboardSocketId
    });

    showConnectionSockets();
  });

  // 호스타가 방을 나갔을 경우
  socket.on('host_out', function(){
    console.log('host_out');
    socket.broadcast.emit('host_out');
  });

  // 방을 나가면 소켓 연결 해제
  socket.on('bye', function(){
    console.log('received bye');
    socket.disconnect();
  });

  // 에러 발생하면 소켓 연결 해제
  socket.on("error", (err) => {
    console.error(err);
    socket.disconnect();
  });

  function sendMessageToSameRoomExceptMe(eventName, senderSocket, message){
    connectedSockets.forEach((socket, id) => {
      // 같은 방
      if(senderSocket.roomId == socket.roomId){
        // 자기자신은 제외
        if(senderSocket.id != id){
          socket.emit(eventName, message);
        }
      }
    });
  }

  function makeUserListSameRoomMsg(senderSocket){
    const result = {
      type: 'userList',
      userList: [],
      initiator: '',
      shareId: screenSharingSockets.get(senderSocket.roomId),
      shareStatus: undefined,
      whiteboardId: whiteboardSockets.get(senderSocket.roomId),
      shareStatus: undefined
    };
  
    try{
      connectedSockets.forEach((socket, id) => {
        // 같은 방
        if(senderSocket.roomId == socket.roomId){
          // const userMsg = {
          //   clientId : id
          // }
          result.userList.push(socket.user);
          result.initiator = senderSocket.id;
        }
      });
    }catch(e){
      console.error(e);
    }
  
    return result;
  }

  function showConnectionSockets(){
    console.log(`[연결된 소켓 정보]`)
    connectedSockets.forEach((socket, id) => {
      console.log(`id:${socket.id}, roomId:${socket.roomId}`)
    });
    if(connectedSockets.size == 0) console.log("연결된 소켓이 없습니다.");
  }

  function getSocketAsClientId(pClientId){
    
    for(let item of connectedSockets){
      const clientId = item[0];
      const socket = item[1];
      if(clientId == pClientId) return connectedSockets.get(clientId);
    }
  }

  function getSocketAsUserId(pUserId){
    for(let item of connectedSockets){
      const clientId = item[0];
      const socket = item[1];
      const user = socket.user;
      if(user.id === pUserId){
        return socket;
      }
    }
    return null;
  }

  function isExistClient(pClientId){
    for (const [clientId, socket] of connectedSockets) {
      if(pClientId == clientId) return true;
    }
    return false;
  }

  function isEmpty(param){
    if(param === undefined || param === null || param === "" || param.size === 0){
      return true;
    }
    return false;
  }

});

  

