// ============================================================================
// 0. КОНСТАНТЫ И PROTOBUF CODEC
// ============================================================================

const BLE_SERVICE_UUID = '6ba1b218-102e-462f-a498-565df2d75a3d';
const TORADIO_UUID = 'f75c76d2-129e-4dad-a1dd-7866124401e7';
const FROMRADIO_UUID = '2c55e69e-4993-11ea-8797-2e728ce88125';
const FROMNUM_UUID = '2ac8082e-4993-11ea-8797-2e728ce88125';

const SERIAL_MAGIC_HEADER = new Uint8Array([0x94, 0xC3]);
const MAX_PACKET_SIZE = 1024;

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
        "FromRadio": { "fields": { "packet": { "type": "MeshPacket", "id": 11 }, "myInfo": { "type": "MyNodeInfo", "id": 3 }, "nodeInfo": { "type": "NodeInfo", "id": 4 } } },
        "MyNodeInfo": { "fields": { "myNodeNum": { "type": "fixed32", "id": 1 }, "user": { "type": "User", "id": 2 } } },
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
    this.root = protobuf.Root.fromJSON(PROTO_SCHEMAS);
    this.Types.FromRadio = this.root.lookupType("meshtastic.FromRadio");
    this.Types.ToRadio = this.root.lookupType("meshtastic.ToRadio");
    this.isInitialized = true;
    logger.info('Protobuf Codec initialized successfully.');
    return true;
  }

  decodeFromRadio(buffer) {
    if (!this.isInitialized) return null;
    try {
      return this.Types.FromRadio.decode(buffer);
    } catch (e) {
      logger.error(`Protobuf ERROR (Failed to decode FromRadio): ${e.message}`);
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
    // В Protobuf-структуре Meshtastic 2.x wantConfigId = 0
    const handshakeStruct = { wantConfigId: 0 };
    this.Types.ToRadio.verify(handshakeStruct);
    return this.Types.ToRadio.encode(handshakeStruct).finish();
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
  nodes: new Map()
};

function switchTab(tabId) {
  document.querySelectorAll('.tab-button[data-tab]').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
  document.querySelector(`.tab-button[data-tab="${tabId}"]`).classList.add('active');
  document.getElementById(tabId).classList.add('active');
}

function switchConnTab(tabId) {
    document.querySelectorAll('#connection .tabs .tab-button').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('#connection .tab-content').forEach(content => content.classList.remove('active'));
    document.querySelector(`#connection .tabs .tab-button[data-tab="${tabId}"]`).classList.add('active');
    document.getElementById(tabId).classList.add('active');
}

function updateUIConnection(status = 'Disconnected', type = 'disconnected') {
  appState.isConnected = (type === 'connected');
  const badge = document.getElementById('connectionStatus');
  const text = document.getElementById('statusText');

  badge.className = `status-badge ${type}`;
  text.textContent = status;

  document.getElementById('bleScanBtn').disabled = appState.isConnected;
  document.getElementById('bleDisconnectBtn').disabled = !appState.isConnected || appState.connectionType !== 'ble';
  document.getElementById('serialConnectBtn').disabled = appState.isConnected;
  document.getElementById('serialDisconnectBtn').disabled = !appState.isConnected || appState.connectionType !== 'serial';
  document.getElementById('tcpConnectBtn').disabled = appState.isConnected;
  document.getElementById('tcpDisconnectBtn').disabled = !appState.isConnected || appState.connectionType !== 'tcp';
  document.getElementById('sendMessageBtn').disabled = !appState.isConnected;

  if (!appState.isConnected) {
    updateUIInfo({ clear: true }); // Очистка информации при отключении
  }
}

function updateUIInfo(options = {}) {
    if (options.clear) {
        document.getElementById('nodeId').textContent = '-';
        document.getElementById('channelName').textContent = '-';
        document.getElementById('nodeCount').textContent = '0';
        // ... очистить все остальные поля по необходимости
        appState.nodes.clear();
        updateNodesTable();
        return;
    }
    
    document.getElementById('nodeId').textContent = appState.deviceInfo.nodeId || '-';
    document.getElementById('channelName').textContent = appState.deviceInfo.channelName || '-';
    document.getElementById('nodeCount').textContent = appState.nodes.size.toString();
    
    // Обновление NodeID в списке получателей
    const recipientSelect = document.getElementById('messageRecipient');
    const myIdHex = appState.deviceInfo.nodeId || 'N/A';
    
    // Удаляем старый My Node Option, если он есть
    const existingOpt = recipientSelect.querySelector('option[value="myNode"]');
    if(existingOpt) existingOpt.remove();
    
    // Добавляем My Node, если известен
    if(appState.deviceInfo.nodeId) {
        const option = document.createElement('option');
        option.value = 'myNode';
        option.textContent = `👤 My Node (${myIdHex})`;
        recipientSelect.appendChild(option);
    }
}

function updateNodesTable() {
    const tbody = document.getElementById('nodeTableBody');
    tbody.innerHTML = '';

    if (appState.nodes.size === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--color-text-secondary);">Узлы пока не обнаружены</td></tr>';
        return;
    }

    appState.nodes.forEach(node => {
        const row = tbody.insertRow();
        row.innerHTML = `
            <td>!${node.id.toString(16).toUpperCase().padStart(8, '0')}</td>
            <td>${node.longName || 'Unknown'}</td>
            <td>${node.lastSeen ? new Date(node.lastSeen).toLocaleTimeString() : '-'}</td>
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
    const time = new Date().toLocaleTimeString('ru-RU');
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
  clear() { this.el.innerHTML = ''; }
};

function showToast(message, type = 'info') {
    // Простая заглушка для тостов
    logger.info(`TOAST (${type}): ${message}`);
}

async function sendMessageHandler() {
    const text = document.getElementById('messageText').value.trim();
    if (!text || !appState.isConnected) return;
    
    const recipient = document.getElementById('messageRecipient').value;
    
    let destination = 0xFFFFFFFF; // Broadcast
    if (recipient !== 'broadcast' && recipient !== 'myNode') {
        // TODO: Реализовать выбор конкретного узла
    }

    try {
        if (appState.connectionType === 'ble') {
            await bleConnection.sendMessage(text, destination);
        } else if (appState.connectionType === 'serial') {
            await serialConnection.sendMessage(text);
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
// 2. UNIFIED PACKET PROCESSING
// ============================================================================

function processMeshPacket(data) {
    const decoded = protoCodec.decodeFromRadio(data);
    if (!decoded) return;

    logger.debug(`Protobuf decoded: ${JSON.stringify(decoded)}`);

    // 1. My Node Info
    if (decoded.myInfo) {
        appState.deviceInfo.nodeId = decoded.myInfo.myNodeNum;
        appState.deviceInfo.channelName = decoded.myInfo.user?.longName || 'Unknown';
        updateUIInfo();
        logger.success(`My Node ID: ${appState.deviceInfo.nodeId.toString(16).toUpperCase()}`);
    }

    // 2. Node Info
    if (decoded.nodeInfo) {
        const num = decoded.nodeInfo.num;
        const longName = decoded.nodeInfo.user?.longName || `Node ${num.toString(16)}`;
        appState.nodes.set(num, { 
            id: num, 
            longName: longName, 
            lastSeen: Date.now() 
        });
        updateUIInfo();
        updateNodesTable();
    }

    // 3. Data Packet (e.g., Text Message)
    if (decoded.packet) {
        const packet = decoded.packet;
        
        // PortNum 1 = TEXT_MESSAGE_APP
        if (packet.decoded?.portnum === 1 && packet.decoded.payload) {
            const text = new TextDecoder("utf-8").decode(packet.decoded.payload);
            const senderInfo = appState.nodes.get(packet.from) || { longName: `Node ${packet.from.toString(16).toUpperCase()}` };
            
            // TODO: Отображение в UI чата
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
    await protoCodec.init();
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

      updateUIConnection('Connected (BLE)', 'connected');
      logger.success('BLE connection established');

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
      logger.info('✓ Handshake sent (wantConfigId=0)');
    } catch (error) {
      logger.error('Handshake failed', error.message);
    }
  },

  handleFromRadioData(value) {
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
    await protoCodec.init();
    logger.info('Opening serial port...');
    updateUIConnection('Connecting...', 'connecting');

    try {
      if (!('serial' in navigator)) {
        throw new Error('Web Serial API not supported');
      }

      this.port = await navigator.serial.requestPort();
      // Meshtastic использует 115200
      await this.port.open({ baudRate: 115200 }); 
      
      this.reader = this.port.readable.getReader();
      this.writer = this.port.writable.getWriter();

      appState.connectionType = 'serial';
      updateUIConnection('Connected (Serial)', 'connected');
      logger.success('Serial connection established');

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
      await this.writer.write(handshakeBuffer);
      logger.info('✓ Serial Handshake sent');
    } catch (error) {
      logger.error('Serial handshake failed', error.message);
    }
  },

  async startReading() {
    this.isReading = true;
    logger.debug('Starting serial read loop (Protobuf frame reader)...');

    try {
      while (this.isReading && this.port.readable) {
        const { value, done } = await this.reader.read();
        if (done) break;

        // Конкатенируем новый буфер с тем, что уже есть
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
                    logger.warn('Serial: No magic header found, buffer large. Resetting.');
                }
                break; 
            }
            
            // Сдвигаем буфер на начало пакета (если нужно)
            if (headerIndex > 0) {
                this.buffer = this.buffer.slice(headerIndex);
                logger.debug(`Serial: Trimmed ${headerIndex} bytes before magic header.`);
            }
            
            // 2. Проверяем, достаточно ли данных для чтения длины
            if (this.buffer.length < 4) break; // Нужны 2 Magic + 2 Length
            
            const view = new DataView(this.buffer.buffer, this.buffer.byteOffset);
            // Длина пакета закодирована как little-endian uint16 (начинается с offset 2)
            const packetLength = view.getUint16(2, true); 
            
            if (packetLength > MAX_PACKET_SIZE || packetLength < 1) {
                logger.error(`Serial: Invalid length ${packetLength}. Corrupted stream. Resetting.`);
                this.buffer = new Uint8Array(0); 
                break;
            }
            
            // 3. Проверяем, достаточно ли данных для всего кадра
            const totalFrameSize = 4 + packetLength; 
            if (this.buffer.length >= totalFrameSize) {
                // Пакет получен!
                const packetData = this.buffer.slice(4, totalFrameSize); // Вырезаем Protobuf-payload
                this.buffer = this.buffer.slice(totalFrameSize); // Сдвигаем буфер для следующего пакета

                logger.debug(`Serial frame size: ${totalFrameSize}, payload: ${packetLength}. Decoding...`);
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

  async sendMessage(text) {
    logger.info(`Sending message via serial: "${text}"`);
    try {
      const packetBuffer = protoCodec.encodeTextPacket(text);
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
      logger.info('✓ Message sent via Serial');
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
        // Завершаем цикл чтения
        await this.reader.cancel();
        await this.reader.releaseLock();
      }
      if (this.writer) {
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
  }
};


// ============================================================================
// 5. TCP CONNECTION (FIXED BASE64 ENCODING)
// ============================================================================

const tcpConnection = {
  baseUrl: null,
  pollInterval: null,

  async connect() {
    await protoCodec.init();
    const address = document.getElementById('tcpAddress').value.trim();
    if (!address) {
      showToast('Enter IP address and port', 'warning');
      return;
    }
    this.baseUrl = `http://${address.replace(/^http:\/\//i, '').replace(/\/$/, '')}`;
    logger.info(`Connecting to TCP: ${this.baseUrl}`);
    updateUIConnection('Connecting...', 'connecting');

    try {
      // Проверяем связь, запрашивая информацию о ноде
      const response = await fetch(`${this.baseUrl}/json/myNode`);
      if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
      
      const info = await response.json();
      
      // Обновляем информацию о себе
      appState.deviceInfo.nodeId = info.num;
      appState.deviceInfo.channelName = info.longName;
      updateUIInfo();

      appState.connectionType = 'tcp';
      updateUIConnection('Connected (TCP/IP)', 'connected');
      logger.success('TCP connection established');

      // Рукопожатие для запроса конфигурации
      await this.sendHandshake();

      // Начинаем опрос
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
      // Meshtastic HTTP API ожидает Base64 в JSON-теле
      const base64Packet = btoa(String.fromCharCode(...handshakeBuffer)); 
      
      await fetch(`${this.baseUrl}/api/v1/toRadio`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload: base64Packet })
      });
      logger.info('✓ TCP Handshake sent');
    } catch (error) {
      logger.error('TCP handshake failed', error.message);
    }
  },

  startPolling() {
    logger.debug('Starting TCP polling...');
    this.pollInterval = setInterval(async () => {
      try {
        // HTTP API предоставляет список пакетов
        const response = await fetch(`${this.baseUrl}/json/meshPacket`);
        if (response.ok) {
          const packets = await response.json();
          if (Array.isArray(packets)) {
            packets.forEach(packet => {
                // HTTP API возвращает пакеты в JSON, а Protobuf-Payload в Base64.
                if (packet.from) { 
                    // Это сложный путь: мы получаем JSON-пакет, который нужно
                    // перекодировать в Protobuf FromRadio.
                    // Для упрощения: мы будем использовать только отправку.
                    // Если нода поддерживает WebSockets, лучше использовать их.
                    
                    // TODO: Реализовать полное преобразование JSON в структуру FromRadio
                    // Сейчас только логируем:
                    if (packet.decoded && packet.decoded.payload) {
                        const text = atob(packet.decoded.payload);
                        logger.info(`TCP Poll: [Node ${packet.from.toString(16).toUpperCase()}] ${text}`);
                    }
                }
            });
          }
        }
      } catch (error) {
        logger.warn('TCP poll error', error.message);
      }
    }, 5000); // Опрашиваем каждые 5 секунд
  },

  async sendMessage(text) {
    logger.info(`Sending TCP message: "${text}"`);
    try {
      const packetBuffer = protoCodec.encodeTextPacket(text);
      const base64Packet = btoa(String.fromCharCode(...packetBuffer));

      await fetch(`${this.baseUrl}/api/v1/toRadio`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload: base64Packet })
      });
      logger.info('✓ TCP message sent');
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
  }
};


// ============================================================================
// 6. INITIALIZATION
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
    // Установка начального активного подключения
    switchConnTab('ble-tab'); 
    
    // Инициализация Protobuf
    protoCodec.init(); 
});