// ============================================================================
// 0. КОНСТАНТЫ И PROTOBUF CODEC
// ============================================================================

const BLE_SERVICE_UUID = '6ba1b218-102e-462f-a498-565df2d75a3d';
const TORADIO_UUID = 'f75c76d2-129e-4dad-a1dd-7866124401e7';
const FROMRADIO_UUID = '2c55e69e-4993-11ea-8797-2e728ce88125';
// const FROMNUM_UUID = '2ac8082e-4993-11ea-8797-2e728ce88125'; // Не используется в последней версии Meshtastic

const SERIAL_MAGIC_HEADER = new Uint8Array([0x94, 0xC3]);
const MAX_PACKET_SIZE = 1024; // Максимальный размер пакета для защиты от переполнения

const PROTO_SCHEMAS = {
  // Минимальная схема Meshtastic, необходимая для декодирования MyInfo, NodeInfo и TextPacket
  "nested": {
    "meshtastic": {
      "nested": {
        "PortNum": { "values": { "UNKNOWN_APP": 0, "TEXT_MESSAGE_APP": 1, "POSITION_APP": 3, "NODEINFO_APP": 4 } },
        "MeshPacket": {
          "fields": {
            "from": { "type": "fixed32", "id": 1 },
            "to": { "type": "fixed32", "id": 2 },
            "decoded": { "type": "Data", "id": 4 },
            "id": { "type": "fixed32", "id": 6 },
            "rxTime": { "type": "fixed32", "id": 7 }
          }
        },
        "Data": {
          "fields": {
            "portnum": { "type": "PortNum", "id": 1 },
            "payload": { "type": "bytes", "id": 2 }
          }
        },
        "FromRadio": { "fields": { "packet": { "type": "MeshPacket", "id": 11 }, "myInfo": { "type": "MyNodeInfo", "id": 3 }, "nodeInfo": { "type": "NodeInfo", "id": 4 }, "configCompleteId": { "type": "uint32", "id": 100 } } },
        "MyNodeInfo": { "fields": { "myNodeNum": { "type": "fixed32", "id": 1 }, "user": { "type": "User", "id": 2 }, "firmwareVersion": { "type": "string", "id": 3 }, "hardwareModel": { "type": "uint32", "id": 4 } } },
        "NodeInfo": { "fields": { "num": { "type": "fixed32", "id": 1 }, "user": { "type": "User", "id": 2 } } },
        "User": { "fields": { "longName": { "type": "string", "id": 2 }, "shortName": { "type": "string", "id": 3 } } },
        "ToRadio": { "fields": { "packet": { "type": "MeshPacket", "id": 1 }, "wantConfigId": { "type": "uint32", "id": 100 } } }
      }
    }
  }
};

class ProtobufCodec {
  constructor() {
    this.root = null;
    this.Types = {};
    this.isInitialized = false;
  }

  async init() {
    if (typeof protobuf === 'undefined') {
      logger.error('Protobuf.js library not loaded. Check index.html!');
      return false;
    }
    try {
        this.root = protobuf.Root.fromJSON(PROTO_SCHEMAS);
        this.Types.FromRadio = this.root.lookupType("meshtastic.FromRadio");
        this.Types.ToRadio = this.root.lookupType("meshtastic.ToRadio");
        this.Types.HardwareModel = this.root.lookupEnum("meshtastic.HardwareModel");
        this.isInitialized = true;
        logger.info('Protobuf Codec initialized successfully.');
        return true;
    } catch (e) {
        logger.error(`Protobuf initialization failed: ${e.message}`);
        return false;
    }
  }

  decodeFromRadio(buffer) {
    if (!this.isInitialized) return null;
    try {
      // Ключевой момент: декодирование бинарного буфера
      return this.Types.FromRadio.decode(buffer); 
    } catch (e) {
      logger.error(`Protobuf ERROR (Failed to decode FromRadio): ${e.message}. RAW length: ${buffer.length}`);
      return null;
    }
  }

  encodeTextPacket(text, destination = 0xFFFFFFFF) {
    if (!this.isInitialized) throw new Error("Protobuf not initialized.");
    const payloadBytes = new TextEncoder().encode(text);
    const packetId = Math.floor(Math.random() * 0xFFFFFFFF);

    const packetStruct = {
      to: destination,
      decoded: {
        portnum: 1, // TEXT_MESSAGE_APP
        payload: payloadBytes
      },
      id: packetId
    };

    const toRadioStruct = { packet: packetStruct };
    this.Types.ToRadio.verify(toRadioStruct);

    return this.Types.ToRadio.encode(toRadioStruct).finish();
  }

  encodeHandshake() {
    if (!this.isInitialized) throw new Error("Protobuf not initialized.");
    // wantConfigId = 0 запрашивает базовую информацию
    const handshakeStruct = { wantConfigId: 0 }; 
    this.Types.ToRadio.verify(handshakeStruct);
    return this.Types.ToRadio.encode(handshakeStruct).finish();
  }
  
  getHardwareModelName(value) {
      return this.Types.HardwareModel.valuesById[value] || `Unknown (${value})`;
  }
}

const protoCodec = new ProtobufCodec();


// ============================================================================
// 1. GLOBAL STATE AND HELPERS (UI, LOGGER, etc.)
// ============================================================================

const appState = {
  isConnected: false,
  connectionType: null,
  deviceInfo: {
    nodeId: null,
    hwModel: '-',
    fwVersion: '-',
    battery: '-',
    region: '-',
    channelName: '-',
    nodeCount: 0,
    uptime: '-'
  },
  nodes: new Map() // Карта для хранения информации о нодах
};

function switchTab(tabId) {
  document.querySelectorAll('.tab-button[data-tab]').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
  
  document.querySelector(`.tab-button[data-tab="${tabId}"]`).classList.add('active');
  document.getElementById(tabId).classList.add('active');
}

function switchConnTab(tabId) {
    document.querySelectorAll('#connection > .tabs .tab-button').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('#connection > .tab-content').forEach(content => content.classList.remove('active'));
    document.querySelector(`#connection > .tabs .tab-button[data-tab="${tabId}"]`).classList.add('active');
    document.getElementById(tabId).classList.add('active');
}

function enableMainTabs(enabled) {
    const mainTabs = ['dashboard', 'lora', 'messages', 'nodes', 'admin'];
    mainTabs.forEach(tabId => {
        const btn = document.querySelector(`.tab-button[data-tab="${tabId}"]`);
        if (btn) btn.disabled = !enabled;
    });
}

function updateUIConnection(status = 'Disconnected', type = 'disconnected') {
  appState.isConnected = (type === 'connected');
  appState.connectionType = (type === 'connected') ? appState.connectionType : null;
  
  const badge = document.getElementById('connectionStatus');
  const text = document.getElementById('statusText');

  badge.className = `status-badge ${type}`;
  text.textContent = status;
  
  // Управление кнопками подключения
  document.getElementById('bleConnectBtn').disabled = appState.isConnected;
  document.getElementById('bleDisconnectBtn').disabled = !appState.isConnected || appState.connectionType !== 'ble';
  document.getElementById('serialConnectBtn').disabled = appState.isConnected;
  document.getElementById('serialDisconnectBtn').disabled = !appState.isConnected || appState.connectionType !== 'serial';
  document.getElementById('tcpConnectBtn').disabled = appState.isConnected;
  document.getElementById('tcpDisconnectBtn').disabled = !appState.isConnected || appState.connectionType !== 'tcp';

  enableMainTabs(appState.isConnected);

  if (!appState.isConnected) {
    updateUIInfo({ clear: true }); 
  }
}

function updateUIInfo(options = {}) {
    if (options.clear) {
        document.getElementById('nodeId').textContent = '-';
        document.getElementById('hwModel').textContent = '-';
        document.getElementById('fwVersion').textContent = '-';
        document.getElementById('battery').textContent = '-';
        document.getElementById('region').textContent = '-';
        document.getElementById('channelName').textContent = '-';
        document.getElementById('nodeCount').textContent = '0';
        document.getElementById('uptime').textContent = '-';

        appState.nodes.clear();
        updateNodesTable();
        return;
    }
    
    document.getElementById('nodeId').textContent = appState.deviceInfo.nodeId ? `!${appState.deviceInfo.nodeId.toString(16).toUpperCase().padStart(8, '0')}` : '-';
    document.getElementById('hwModel').textContent = appState.deviceInfo.hwModel || '-';
    document.getElementById('fwVersion').textContent = appState.deviceInfo.fwVersion || '-';
    document.getElementById('channelName').textContent = appState.deviceInfo.channelName || '-';
    document.getElementById('nodeCount').textContent = appState.nodes.size.toString();
}

function updateNodesTable() {
    const tbody = document.getElementById('nodeTableBody');
    tbody.innerHTML = '';

    if (appState.nodes.size === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--color-text-secondary);">No nodes discovered yet</td></tr>';
        return;
    }

    // Сортировка по ID
    const sortedNodes = Array.from(appState.nodes.values()).sort((a, b) => a.id - b.id);

    sortedNodes.forEach(node => {
        const row = tbody.insertRow();
        const nodeIdHex = node.id.toString(16).toUpperCase().padStart(8, '0');
        const lastSeenTime = node.lastSeen ? new Date(node.lastSeen).toLocaleTimeString() : '-';

        row.innerHTML = `
            <td>!${nodeIdHex}</td>
            <td>${node.longName || `Node ${nodeIdHex}`}</td>
            <td>${lastSeenTime}</td>
            <td>${node.rssi || '-'}</td>
            <td>${node.snr || '-'}</td>
            <td>${node.numHops || '-'}</td>
        `;
    });
}

const logger = {
  el: document.getElementById('logConsole'),
  log(level, ...args) {
    const msg = args.join(' ');
    if (!this.el) return;
    
    // Исправлена ошибка: `logger.success` не существует, используем INFO или WARN/ERROR
    if (level === 'SUCCESS') level = 'INFO'; 
    
    const time = new Date().toLocaleTimeString('en-US');
    const line = document.createElement('div');
    line.className = 'log-entry';
    line.innerHTML = `
      <span class="log-time">[${time}]</span>
      <span class="log-level ${level}">${level}</span>
      <span class="log-message">${msg}</span>
    `;
    this.el.appendChild(line);
    this.el.scrollTop = this.el.scrollHeight;
  },
  debug(...m) { this.log('DEBUG', ...m); },
  info(...m) { this.log('INFO', ...m); },
  warn(...m) { this.log('WARN', ...m); },
  error(...m) { this.log('ERROR', ...m); },
  clear() { 
      const el = document.getElementById('logConsole');
      if (el) el.innerHTML = ''; 
  },
  // Добавление функции для успешного сообщения, чтобы избежать ошибок
  success(...m) { this.log('INFO', '✓', ...m); }
};

function showToast(message, type = 'info') {
    // Временно используем log, пока не реализован полноценный Toast UI
    logger.info(`TOAST (${type.toUpperCase()}): ${message}`);
}

async function sendMessageHandler() {
    const text = document.getElementById('messageText').value.trim();
    if (!text || !appState.isConnected) return;
    
    // В данной версии всегда отправляем Broadcast
    const destination = 0xFFFFFFFF; 

    try {
        if (appState.connectionType === 'ble') {
            await bleConnection.sendMessage(text, destination);
        } else if (appState.connectionType === 'serial') {
            // Serial использует унифицированную Protobuf-отправку
            await serialConnection.sendMessage(text, destination); 
        } else if (appState.connectionType === 'tcp') {
            await tcpConnection.sendMessage(text);
        }
        document.getElementById('messageText').value = '';
    } catch (e) {
        logger.error(`Failed to send message: ${e.message}`);
        showToast('Failed to send message', 'error');
    }
}


// ============================================================================
// 2. UNIFIED PACKET PROCESSING (FIXED PROTOBUF DECODING)
// ============================================================================

function processMeshPacket(data) {
    const decoded = protoCodec.decodeFromRadio(data);
    if (!decoded) return;

    logger.debug(`Protobuf decoded: ${JSON.stringify(decoded)}`);

    // 1. My Node Info (Конфигурация устройства)
    if (decoded.myInfo) {
        appState.deviceInfo.nodeId = decoded.myInfo.myNodeNum;
        appState.deviceInfo.channelName = decoded.myInfo.user?.longName || 'Unknown';
        appState.deviceInfo.fwVersion = decoded.myInfo.firmwareVersion || '-';
        appState.deviceInfo.hwModel = protoCodec.getHardwareModelName(decoded.myInfo.hardwareModel);
        updateUIInfo();
        logger.success(`Node Info Received. ID: !${appState.deviceInfo.nodeId.toString(16).toUpperCase()}`);
    }

    // 2. Node Info (Состояние других нод)
    if (decoded.nodeInfo) {
        const num = decoded.nodeInfo.num;
        const longName = decoded.nodeInfo.user?.longName || `Node ${num.toString(16)}`;
        
        // В упрощенном варианте просто обновляем Last Seen
        let node = appState.nodes.get(num) || { id: num };
        node = { 
            ...node, 
            longName: longName, 
            lastSeen: Date.now() 
        };
        appState.nodes.set(num, node);
        
        updateUIInfo();
        updateNodesTable();
        logger.debug(`Node ${num.toString(16)} updated.`);
    }

    // 3. Data Packet (Например, текстовое сообщение)
    if (decoded.packet) {
        const packet = decoded.packet;
        
        // PortNum 1 = TEXT_MESSAGE_APP
        if (packet.decoded?.portnum === 1 && packet.decoded.payload) {
            const text = new TextDecoder("utf-8").decode(packet.decoded.payload);
            const senderInfo = appState.nodes.get(packet.from) || { longName: `Node !${packet.from.toString(16).toUpperCase()}` };
            
            logger.info(`CHAT: [${senderInfo.longName}] ${text}`);
            showToast(`New Message from ${senderInfo.longName}`, 'info');
        }
    }
}


// ============================================================================
// 3. BLE CONNECTION (FIXED PROTOBUF)
// ============================================================================

const bleConnection = {
  device: null,
  toRadio: null,
  fromRadio: null,
  
  async connect() {
    if (!await protoCodec.init()) return;

    logger.info('Starting BLE connection...');
    updateUIConnection('Connecting...', 'connecting');

    try {
      if (!navigator.bluetooth) {
        throw new Error('Web Bluetooth not supported');
      }

      this.device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [BLE_SERVICE_UUID] }],
        optionalServices: [BLE_SERVICE_UUID]
      });

      this.device.addEventListener('gattserverdisconnected', () => this.disconnect());

      const server = await this.device.gatt.connect();
      const service = await server.getPrimaryService(BLE_SERVICE_UUID);
      
      this.toRadio = await service.getCharacteristic(TORADIO_UUID);
      this.fromRadio = await service.getCharacteristic(FROMRADIO_UUID);
      
      await this.fromRadio.startNotifications();
      this.fromRadio.addEventListener('characteristicvaluechanged', (e) => this.handleFromRadioData(e.target.value));

      appState.connectionType = 'ble';
      updateUIConnection('Connected (BLE)', 'connected');
      logger.success('BLE connection established');
      showToast('BLE connected successfully!', 'success');

      await this.sendHandshake();

    } catch (error) {
      logger.error('BLE connection failed', error.message);
      this.disconnect();
      updateUIConnection('Disconnected', 'disconnected');
      showToast('BLE connection failed', 'error');
    }
  },

  async sendHandshake() {
    logger.debug('Sending Protobuf handshake...');
    try {
      const handshakeBuffer = protoCodec.encodeHandshake();
      await this.toRadio.writeValue(handshakeBuffer);
      logger.info('✓ Handshake sent (requesting config)');
    } catch (error) {
      logger.error('Handshake failed', error.message);
    }
  },

  handleFromRadioData(value) {
    // Value.buffer is ArrayBuffer, Uint8Array(value.buffer) is correct
    const data = new Uint8Array(value.buffer); 
    logger.debug(`BLE Received ${data.length} bytes`);
    processMeshPacket(data);
  },

  async sendMessage(text, destination) {
    logger.info(`Sending message via BLE: "${text}"`);
    try {
      const packetBuffer = protoCodec.encodeTextPacket(text, destination);
      await this.toRadio.writeValue(packetBuffer);
      logger.info('✓ Message sent via BLE');
      showToast('Message sent!', 'success');
    } catch (error) {
      logger.error('BLE Send failed', error.message);
      throw error;
    }
  },

  disconnect() {
    logger.info('Disconnecting BLE...');
    if (this.device && this.device.gatt.connected) {
      this.device.gatt.disconnect();
    }
    this.device = null;
    updateUIConnection('Disconnected', 'disconnected');
    showToast('Disconnected', 'info');
  }
};


// ============================================================================
// 4. SERIAL CONNECTION (CRITICAL FIX: PROTOBUF FRAME READER)
// ============================================================================

const serialConnection = {
  port: null,
  reader: null,
  writer: null,
  isReading: false,
  buffer: new Uint8Array(0),

  async connect() {
    if (!await protoCodec.init()) return;

    logger.info('Opening serial port...');
    updateUIConnection('Connecting...', 'connecting');

    try {
      if (!('serial' in navigator)) {
        throw new Error('Web Serial API not supported');
      }

      this.port = await navigator.serial.requestPort();
      // Meshtastic использует 115200 baud
      await this.port.open({ baudRate: 115200 }); 
      
      // КЛЮЧЕВОЕ ИЗМЕНЕНИЕ: Используем сырые байтовые потоки, а не TextDecoderStream
      this.reader = this.port.readable.getReader(); 
      this.writer = this.port.writable.getWriter();

      appState.connectionType = 'serial';
      updateUIConnection('Connected (Serial)', 'connected');
      logger.success('Serial connection established');
      showToast('Serial connected!', 'success');

      await this.sendHandshake();
      this.startReading();

    } catch (error) {
      logger.error('Serial connection failed', error.message);
      this.disconnect();
      updateUIConnection('Disconnected', 'disconnected');
      showToast('Serial connection failed', 'error');
    }
  },

  async sendHandshake() {
    logger.debug('Sending serial Protobuf handshake...');
    try {
      const handshakeBuffer = protoCodec.encodeHandshake();
      // Serial API Meshtastic ожидает фрейм
      await this.writeFramedPacket(handshakeBuffer); 
      logger.info('✓ Serial Handshake sent');
    } catch (error) {
      logger.error('Serial handshake failed', error.message);
    }
  },
  
  async writeFramedPacket(packetBuffer) {
      // Serial API Meshtastic ожидает фрейм (Magic + Length + Payload)
      const frameLength = packetBuffer.length;
      const frame = new Uint8Array(4 + frameLength);
      
      // Magic Header 0x94 0xC3
      frame[0] = SERIAL_MAGIC_HEADER[0];
      frame[1] = SERIAL_MAGIC_HEADER[1];
      
      // Length (little-endian uint16)
      frame[2] = frameLength & 0xFF;
      frame[3] = (frameLength >> 8) & 0xFF;
      
      // Payload
      frame.set(packetBuffer, 4); 

      await this.writer.write(frame);
  },

  async startReading() {
    this.isReading = true;
    logger.debug('Starting serial read loop (Protobuf frame reader)...');

    try {
      while (this.isReading && this.port.readable) {
        const { value, done } = await this.reader.read();
        if (done) break;

        // Конкатенируем новый буфер
        const newBuffer = new Uint8Array(this.buffer.length + value.length);
        newBuffer.set(this.buffer);
        newBuffer.set(value, this.buffer.length);
        this.buffer = newBuffer;

        let packetFound = true;
        while (packetFound) {
            packetFound = false;

            // 1. Ищем Magic Header (0x94 0xC3)
            let headerIndex = -1;
            for(let i = 0; i < this.buffer.length - 1; i++) {
                if (this.buffer[i] === SERIAL_MAGIC_HEADER[0] && this.buffer[i + 1] === SERIAL_MAGIC_HEADER[1]) {
                    headerIndex = i;
                    break;
                }
            }

            if (headerIndex === -1) {
                // Если буфер большой, но заголовка нет, чистим и выходим
                if (this.buffer.length > MAX_PACKET_SIZE * 2) { 
                    this.buffer = new Uint8Array(0); 
                    logger.warn('Serial: No magic header found, buffer large. Resetting buffer.');
                }
                break; 
            }
            
            // Сдвигаем буфер на начало пакета
            if (headerIndex > 0) {
                logger.warn(`Serial: Found ${headerIndex} unhandled bytes before header. Trimming.`);
                this.buffer = this.buffer.slice(headerIndex);
            }
            
            // 2. Проверяем, достаточно ли данных для чтения длины (4 байта для Magic+Length)
            if (this.buffer.length < 4) break; 
            
            const view = new DataView(this.buffer.buffer, this.buffer.byteOffset);
            // Длина пакета (Protobuf payload) закодирована как little-endian uint16
            const packetLength = view.getUint16(2, true); 
            
            if (packetLength > MAX_PACKET_SIZE || packetLength < 1) {
                logger.error(`Serial: Invalid length ${packetLength}. Corrupted stream. Resetting buffer.`);
                this.buffer = new Uint8Array(0); 
                break;
            }
            
            // 3. Проверяем, достаточно ли данных для всего кадра (Magic + Length + Payload)
            const totalFrameSize = 4 + packetLength; 
            if (this.buffer.length >= totalFrameSize) {
                // Пакет получен!
                const packetData = this.buffer.slice(4, totalFrameSize); 
                this.buffer = this.buffer.slice(totalFrameSize); 

                logger.debug(`Serial frame received. Payload: ${packetLength} bytes. Decoding...`);
                processMeshPacket(packetData); // Обработка чистого Protobuf
                packetFound = true; // Продолжаем проверять, нет ли еще пакетов
            }
        }
      }
    } catch (error) {
      if (this.isReading) {
        logger.error('Serial read error', error.message);
      }
    } finally {
      this.disconnect();
    }
  },

  async sendMessage(text, destination) {
    logger.info(`Sending message via serial: "${text}"`);
    try {
      const packetBuffer = protoCodec.encodeTextPacket(text, destination);
      await this.writeFramedPacket(packetBuffer);
      logger.info('✓ Message sent via Serial (Framed Protobuf)');
      showToast('Message sent!', 'success');
    } catch (error) {
      logger.error('Serial send failed', error.message);
      throw error;
    }
  },

  async disconnect() {
    logger.info('Closing serial port...');
    this.isReading = false;
    this.buffer = new Uint8Array(0);

    try {
      if (this.reader) {
        // Отменяем чтение и освобождаем блокировку
        await this.reader.cancel();
        await this.reader.releaseLock();
      }
      if (this.writer) {
        await this.writer.close(); // Close the writer
        await this.writer.releaseLock();
      }
      if (this.port) {
        await this.port.close();
      }
    } catch (error) {
      logger.warn('Error during serial disconnect', error.message);
    }

    this.port = null;
    updateUIConnection('Disconnected', 'disconnected');
    showToast('Disconnected', 'info');
  }
};


// ============================================================================
// 5. TCP CONNECTION (FIXED BASE64 ENCODING)
// ============================================================================

const tcpConnection = {
  baseUrl: null,
  pollInterval: null,

  async connect() {
    if (!await protoCodec.init()) return;

    const address = document.getElementById('tcpAddress').value.trim();
    if (!address) {
      showToast('Enter IP address and port', 'warning');
      return;
    }
    // Проверяем, есть ли http/https, если нет, добавляем http
    this.baseUrl = address.match(/^https?:\/\//) ? address : `http://${address}`;
    this.baseUrl = this.baseUrl.replace(/\/$/, '');
    
    logger.info(`Connecting to TCP: ${this.baseUrl}`);
    updateUIConnection('Connecting...', 'connecting');

    try {
      // Test connection by fetching system info
      const response = await fetch(`${this.baseUrl}/json/myNode`);
      if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
      
      const info = await response.json();
      
      // Update basic node info (since TCP API often returns JSON)
      appState.deviceInfo.nodeId = info.num;
      appState.deviceInfo.channelName = info.longName;
      updateUIInfo();

      appState.connectionType = 'tcp';
      updateUIConnection('Connected (TCP/IP)', 'connected');
      logger.success('TCP connection established');
      showToast('TCP connected!', 'success');

      // Send Protobuf handshake
      await this.sendHandshake();

      this.startPolling();

    } catch (error) {
      logger.error('TCP connection failed', error.message);
      this.disconnect();
      updateUIConnection('Disconnected', 'disconnected');
      showToast('TCP connection failed', 'error');
    }
  },

  async sendHandshake() {
    logger.debug('Sending TCP Protobuf handshake...');
    try {
      const handshakeBuffer = protoCodec.encodeHandshake();
      // TCP API Meshtastic ожидает Base64-кодированный Protobuf в JSON-теле
      const base64Packet = btoa(String.fromCharCode(...handshakeBuffer)); 
      
      await fetch(`${this.baseUrl}/api/v1/toRadio`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload: base64Packet })
      });
      logger.info('✓ TCP Handshake sent (Base64 Protobuf)');
    } catch (error) {
      logger.error('TCP handshake failed', error.message);
    }
  },

  startPolling() {
    logger.debug('Starting TCP polling...');
    this.pollInterval = setInterval(async () => {
      // В упрощенном варианте мы только опрашиваем
      // В реальном приложении лучше использовать WebSockets, если они доступны
      try {
        const response = await fetch(`${this.baseUrl}/json/meshPacket`);
        if (response.ok) {
          const packets = await response.json();
          if (Array.isArray(packets)) {
            packets.forEach(packet => {
                // Если API возвращает JSON-структуру пакета, можно отобразить его
                if (packet.decoded && packet.decoded.portnum === 1 && packet.decoded.payload) {
                    try {
                        // Payload в TCP API часто Base64, декодируем
                        const text = atob(packet.decoded.payload);
                        const senderId = packet.from || 'Unknown';
                        logger.info(`TCP Poll (CHAT): [Node !${senderId.toString(16).toUpperCase()}] ${text}`);
                    } catch (e) {
                        logger.warn('TCP: Could not decode Base64 payload.', e.message);
                    }
                }
            });
          }
        }
      } catch (error) {
        // Молчание, чтобы не забивать логи
      }
    }, 5000); // Опрашиваем каждые 5 секунд
  },

  async sendMessage(text) {
    logger.info(`Sending TCP message: "${text}"`);
    try {
      const packetBuffer = protoCodec.encodeTextPacket(text, 0xFFFFFFFF);
      const base64Packet = btoa(String.fromCharCode(...packetBuffer));

      await fetch(`${this.baseUrl}/api/v1/toRadio`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload: base64Packet })
      });
      logger.info('✓ TCP message sent (Base64 Protobuf)');
      showToast('Message sent!', 'success');
    } catch (error) {
      logger.error('TCP send failed', error.message);
      throw error;
    }
  },

  disconnect() {
    logger.info('Disconnecting TCP...');
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.baseUrl = null;
    updateUIConnection('Disconnected', 'disconnected');
    showToast('Disconnected', 'info');
  }
};


// ============================================================================
// 6. INITIALIZATION
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
    // Назначение обработчиков событий для вкладок
    document.querySelectorAll('.tab-button[data-tab]').forEach(btn => {
        const tabId = btn.getAttribute('data-tab');
        btn.onclick = () => switchTab(tabId);
    });

    document.querySelectorAll('#connection > .tabs .tab-button').forEach(btn => {
        const tabId = btn.getAttribute('data-tab');
        btn.onclick = () => switchConnTab(tabId);
    });
    
    // Инициализация UI
    switchTab('connection');
    switchConnTab('ble-tab'); 
    updateUIConnection();

    // Предварительная инициализация Protobuf (асинхронно)
    protoCodec.init(); 
});