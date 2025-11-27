// ============================================================================
// ГЛОБАЛЬНЫЕ КОНСТАНТЫ И СТАТУС
// ============================================================================

const BLE_SERVICE_UUID = '42f9a997-c100-4b2e-80c1-3d7729f28d84';
const TORADIO_UUID = '42f9a997-c100-4b2e-80c1-3d7729f28d85';
const FROMRADIO_UUID = '42f9a997-c100-4b2e-80c1-3d7729f28d86';
const FROMNUM_UUID = '42f9a997-c100-4b2e-80c1-3d7729f28d87';

const appState = {
    isConnected: false,
    connectionType: null,
    deviceInfo: {
        nodeId: '-',
        firmwareVersion: '-',
        hwModel: '-',
        region: '-',
        battery: '-',
        channelName: '-',
        nodeCount: 0,
        uptime: '-',
    },
    // ...
};

// ============================================================================
// УТИЛИТЫ (Logger и Toast)
// ============================================================================

// ИСПРАВЛЕНО: logger теперь использует только info, debug, warn, error
const logger = {
    _log(level, ...args) {
        const timestamp = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        // Использование JSON.stringify для объектов
        const message = args.map(a => (typeof a === 'object' ? JSON.stringify(a, null, 2) : a)).join(' ');
        const logEntry = document.createElement('div');
        logEntry.classList.add('log-entry');
        logEntry.innerHTML = `<span class="log-time">[${timestamp}]</span><span class="log-level ${level}">${level}</span><span class="log-message">${message}</span>`;
        const console = document.getElementById('logConsole');
        if (console) {
            console.appendChild(logEntry);
            console.scrollTop = console.scrollHeight;
        }
    },
    debug(...args) { this._log('DEBUG', ...args); },
    info(...args) { this._log('INFO', ...args); },
    warn(...args) { this._log('WARN', ...args); },
    error(...args) { this._log('ERROR', ...args); }
};

function showToast(message, type = 'info') {
    const existingToast = document.querySelector('.toast');
    if (existingToast) existingToast.remove();

    const toast = document.createElement('div');
    toast.classList.add('toast', type);
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.remove();
    }, 4000);
}

// ============================================================================
// УТИЛИТЫ UI
// ============================================================================

function updateUIConnection() {
    const statusBadge = document.getElementById('connectionStatus');
    const statusText = document.getElementById('statusText');
    const connectBtns = document.querySelectorAll('#bleScanBtn, #serialConnectBtn, #tcpConnectBtn');
    const disconnectBtns = document.querySelectorAll('#bleDisconnectBtn, #serialDisconnectBtn, #tcpDisconnectBtn');

    statusBadge.className = 'status-badge ' + (appState.isConnected ? 'connected' : 'disconnected');
    statusText.textContent = appState.isConnected ? `Connected (${appState.connectionType.toUpperCase()})` : 'Disconnected';

    connectBtns.forEach(btn => btn.disabled = appState.isConnected);
    // Отключаем кнопки Disconnect, только если нет активного соединения
    document.getElementById('bleDisconnectBtn').disabled = !(appState.isConnected && appState.connectionType === 'ble');
    document.getElementById('serialDisconnectBtn').disabled = !(appState.isConnected && appState.connectionType === 'serial');
    document.getElementById('tcpDisconnectBtn').disabled = !(appState.isConnected && appState.connectionType === 'tcp');
}

function updateUIInfo() {
    // В этом месте обновляется UI на основе appState.deviceInfo
    document.getElementById('nodeId').textContent = appState.deviceInfo.nodeId || '-';
    document.getElementById('hwModel').textContent = appState.deviceInfo.hwModel || '-';
    document.getElementById('fwVersion').textContent = appState.deviceInfo.firmwareVersion || '-';
    document.getElementById('battery').textContent = appState.deviceInfo.battery || '-';
    document.getElementById('region').textContent = appState.deviceInfo.region || '-';
    document.getElementById('channelName').textContent = appState.deviceInfo.channelName || '-';
    document.getElementById('nodeCount').textContent = appState.deviceInfo.nodeCount || '0';
    document.getElementById('uptime').textContent = appState.deviceInfo.uptime || '-';
}

// ============================================================================
// MESHTASTIC PROTOBUF HELPERS (ИСПРАВЛЕНО!)
// ============================================================================

let ToRadio, FromRadio, HardwareModel, Config, PortNum;

// Проверяем, что Protobuf инициализирован
if (typeof protobuf === 'undefined' || !protobuf.roots.meshtastic) {
    logger.error("Protobuf DECODE/ENCODE initialization FAILED. Check file meshtastic_pb.js");
    // Устанавливаем заглушки, чтобы избежать сбоя приложения
    const emptyFn = () => new Uint8Array([0x00]);
    ToRadio = { create: () => ({}), encode: () => ({ finish: emptyFn }) };
    FromRadio = { decode: () => ({ toJSON: () => ({}) }) };
    HardwareModel = { valuesById: {} };
    Config = { RegionCode: { valuesById: {} } };
    PortNum = { valuesById: {1: "TEXT_MESSAGE_APP"} };
} else {
    // Инициализация рабочих классов
    const meshtasticRoot = protobuf.roots.meshtastic;
    ToRadio = meshtasticRoot.ToRadio;
    FromRadio = meshtasticRoot.FromRadio;
    HardwareModel = meshtasticRoot.HardwareModel;
    Config = meshtasticRoot.Config;
    PortNum = meshtasticRoot.PortNum;
    logger.info("Protobuf Codec initialized successfully.");
}


function decodeFromRadio(data) {
    try {
        if (!FromRadio || !FromRadio.decode) {
             throw new Error("Decoder not defined.");
        }
        
        const decoded = FromRadio.decode(data);
        const json = decoded.toJSON();
        logger.info(`Protobuf decoded successfully. Device: ${json.myNode ? json.myNode.id : 'N/A'}`);

        // --- Обновление глобального состояния из РЕАЛЬНЫХ ДАННЫХ ---
        if (json.myNode) {
            appState.deviceInfo.nodeId = json.myNode.id ? `!${json.myNode.id.toString(16).padStart(8, '0').toUpperCase()}` : '-';
            if (json.myNode.user && json.myNode.user.longName) {
                appState.deviceInfo.channelName = json.myNode.user.longName;
            }
        }
        if (json.deviceMetrics) {
            appState.deviceInfo.battery = `${json.deviceMetrics.batteryLevel !== undefined ? json.deviceMetrics.batteryLevel : '-'}%`;
            if (json.deviceMetrics.upTimeSeconds) {
                // Преобразование секунд в H:M:S
                const h = Math.floor(json.deviceMetrics.upTimeSeconds / 3600);
                const m = Math.floor((json.deviceMetrics.upTimeSeconds % 3600) / 60);
                const s = json.deviceMetrics.upTimeSeconds % 60;
                appState.deviceInfo.uptime = `${h}h ${m}m ${s}s`;
            }
        }
        if (json.deviceMetadata) {
            appState.deviceInfo.firmwareVersion = json.deviceMetadata.firmwareVersion || 'N/A';
            appState.deviceInfo.hwModel = HardwareModel.valuesById[json.deviceMetadata.hwModel] || 'UNKNOWN';
            appState.deviceInfo.region = Config.RegionCode.valuesById[json.deviceMetadata.region] || 'N/A';
        }
        updateUIInfo();

        if (json.packet) {
            const portName = PortNum.valuesById[json.packet.decoded.portnum] || json.packet.decoded.portnum;
            logger.info(`Received packet: Port=${portName}, PayloadLength=${json.packet.decoded.payload ? json.packet.decoded.payload.length : 0}`);
        }

        return json;
    } catch (error) {
        logger.error(`Protobuf DECODE failed: ${error.message}`);
        // Полезно для отладки, но может быть слишком длинно
        // logger.debug('Raw data HEX:', Array.from(data).map(b => b.toString(16).padStart(2, '0')).join(' '));
        return null;
    }
}

function encodeToRadio(payload) {
    try {
        if (!ToRadio || !ToRadio.encode) {
             throw new Error("Encoder not defined.");
        }
        const message = ToRadio.create(payload);
        const encoded = ToRadio.encode(message).finish();
        return encoded;
    } catch (error) {
        logger.error(`Protobuf ENCODE failed: ${error.message}`);
        throw error;
    }
}

// ============================================================================
// BLE CONNECTION
// ============================================================================

const bleConnection = {
    device: null,
    server: null,
    toRadio: null,
    fromRadio: null,
    fromNum: null,
    isReading: false,
    
    async scan() {
        logger.info('Starting BLE scan...');
        try {
            if (!navigator.bluetooth) {
                throw new Error('Web Bluetooth not supported');
            }

            this.device = await navigator.bluetooth.requestDevice({
                filters: [
                    { services: [BLE_SERVICE_UUID] }
                ],
                optionalServices: [BLE_SERVICE_UUID]
            });

            logger.info(`Device found: ${this.device.name || 'Unknown'}`);
            return this.device;
        } catch (error) {
            logger.error('BLE scan failed', error.message);
            throw error;
        }
    },

    async connect() {
        logger.info('Connecting to BLE device...');
        try {
            if (!this.device) {
                await this.scan();
            }

            this.server = await this.device.gatt.connect();
            this.service = await this.server.getPrimaryService(BLE_SERVICE_UUID);
            this.toRadio = await this.service.getCharacteristic(TORADIO_UUID);
            this.fromRadio = await this.service.getCharacteristic(FROMRADIO_UUID);
            this.fromNum = await this.service.getCharacteristic(FROMNUM_UUID); // Добавлено для fromNum

            await this.fromRadio.startNotifications();
            this.fromRadio.addEventListener('characteristicvaluechanged', (event) => {
                this.handleFromRadioData(event.target.value);
            });

            appState.connectionType = 'ble';
            appState.isConnected = true;
            updateUIConnection();
            logger.info('✓ BLE connection established');

            // Отправляем handshake для получения конфигурации
            await this.sendHandshake(); 
            this.startReading(); // Начинаем цикл чтения numBytes

            showToast('BLE connected successfully!', 'success');
        } catch (error) {
            logger.error('BLE connection failed', error.message);
            this.disconnect();
            showToast('BLE connection failed', 'error');
            throw error;
        }
    },
    
    async disconnect() {
        logger.info('Disconnecting BLE...');
        this.isReading = false;
        if (this.device && this.device.gatt.connected) {
            this.device.gatt.disconnect();
        }
        this.device = null;
        appState.isConnected = false;
        appState.connectionType = null;
        updateUIConnection();
        logger.info('✓ BLE disconnected');
        showToast('Disconnected', 'info');
    },

    async sendHandshake() {
        logger.debug('Sending handshake (want_config_id)...');
        try {
            // ИСПОЛЬЗУЕМ Protobuf для корректного handshake
            const configRequest = encodeToRadio({
                wantConfigId: 0
            });
            await this.toRadio.writeValue(configRequest);
            logger.info(`✓ Handshake sent: ${configRequest.length} bytes`);
        } catch (error) {
            logger.error('Handshake failed', error.message);
        }
    },

    handleFromRadioData(value) {
        const data = new Uint8Array(value.buffer);
        logger.debug(`Raw data: ${data.length} bytes received`);
        // ИСПОЛЬЗУЕМ Protobuf для декодирования
        decodeFromRadio(data);
    },
    
    // Новая логика для непрерывного чтения (как в Meshtastic Web)
    async startReading() {
        this.isReading = true;
        logger.debug('Starting continuous read loop...');

        while (appState.isConnected && this.isReading) {
            try {
                // 1. Читаем количество доступных байт
                const numValue = await this.fromNum.readValue();
                const numBytes = numValue.getUint32(0, true);

                if (numBytes > 0) {
                    logger.debug(`${numBytes} bytes available to read`);
                    // 2. Читаем данные из fromRadio
                    const data = await this.fromRadio.readValue();
                    this.handleFromRadioData(data);
                }

                await new Promise(resolve => setTimeout(resolve, 100));
            } catch (error) {
                if (appState.isConnected) {
                    logger.error('BLE Read error', error.message);
                }
                break;
            }
        }
    },

    async sendMessage(text, destination = 0xFFFFFFFF) {
        logger.info(`Sending message: "${text}" to ${destination.toString(16)}`);
        try {
            // ИСПОЛЬЗУЕМ Protobuf для кодирования сообщения
            const messagePayload = encodeToRadio({
                packet: {
                    decoded: {
                        portnum: PortNum.TEXT_MESSAGE_APP, // 1
                        payload: new TextEncoder().encode(text)
                    },
                    to: destination
                }
            });

            await this.toRadio.writeValue(messagePayload);
            logger.info('✓ Message sent');
            showToast('Message sent!', 'success');
        } catch (error) {
            logger.error('Send failed', error.message);
            showToast('Failed to send message', 'error');
        }
    },
};

// ============================================================================
// SERIAL CONNECTION
// ============================================================================

const serialConnection = {
    port: null,
    reader: null,
    writer: null,
    isReading: false,
    
    async connect() {
        logger.info('Opening serial port...');
        try {
            if (!('serial' in navigator)) {
                throw new Error('Web Serial API not supported');
            }

            this.port = await navigator.serial.requestPort();
            // Используем ArrayBuffer для бинарных данных Protobuf
            await this.port.open({ baudRate: 115200 });

            this.reader = this.port.readable.getReader();
            this.writer = this.port.writable.getWriter();

            appState.connectionType = 'serial';
            appState.isConnected = true;
            updateUIConnection();
            logger.info('✓ Serial connection established');

            await this.sendHandshake();
            this.startReading();

            showToast('Serial connected!', 'success');
        } catch (error) {
            // ИСПРАВЛЕНО: logger.success заменено на logger.error
            logger.error('Serial connection failed', error.message);
            this.disconnect();
            showToast('Serial connection failed', 'error');
            throw error;
        }
    },

    async disconnect() {
        logger.info('Closing serial port...');
        this.isReading = false;

        try {
            if (this.reader) {
                await this.reader.cancel();
                await this.reader.releaseLock();
            }
            if (this.writer) {
                this.writer.releaseLock();
                // Не нужно await this.writer.close() здесь для ArrayBuffer.
            }
            if (this.port) {
                await this.port.close();
            }
        } catch (error) {
            logger.warn('Error during serial disconnect', error.message);
        }

        this.port = null;
        appState.isConnected = false;
        appState.connectionType = null;
        updateUIConnection();
        logger.info('✓ Serial disconnected');
        showToast('Disconnected', 'info');
    },

    async sendHandshake() {
        logger.debug('Sending serial handshake...');
        try {
            // ИСПОЛЬЗУЕМ Protobuf для корректного handshake
            const configRequest = encodeToRadio({
                wantConfigId: 0
            });
            // В реальном проекте Meshtastic используется SLIP-кодирование. 
            // Здесь для простоты отправляется только Protobuf-пакет.
            await this.writer.write(configRequest);
            logger.info(`✓ Serial handshake sent: ${configRequest.length} bytes`);
        } catch (error) {
            logger.error('Serial handshake failed', error.message);
        }
    },
    
    // Эта функция будет работать с ArrayBuffer, а не Text (как в предыдущей версии)
    async startReading() {
        this.isReading = true;
        logger.debug('Starting serial read loop...');

        try {
            // Создаем простой буфер для приема данных (без SLIP-декодера, который нужен в реальном проекте)
            const buffer = new Uint8Array(1024);
            let offset = 0;
            
            while (this.isReading) {
                const { value, done } = await this.reader.read();
                if (done) {
                    logger.warn('Serial stream closed');
                    break;
                }

                if (value && value.length > 0) {
                    logger.debug(`Serial received: ${value.length} bytes`);
                    
                    // ВРЕМЕННОЕ РЕШЕНИЕ: Просто декодируем, предполагая, что это полный пакет.
                    // Реально тут должен быть SLIP-декодер.
                    decodeFromRadio(value);
                }
            }
        } catch (error) {
            if (this.isReading) {
                logger.error('Serial read error', error.message);
            }
        }
    },

    async sendMessage(text) {
        logger.info(`Sending message via serial: "${text}"`);
        try {
            // ИСПОЛЬЗУЕМ Protobuf для кодирования сообщения
             const messagePayload = encodeToRadio({
                packet: {
                    decoded: {
                        portnum: PortNum.TEXT_MESSAGE_APP, // 1
                        payload: new TextEncoder().encode(text)
                    },
                    to: 0xFFFFFFFF
                }
            });
            await this.writer.write(messagePayload);
            logger.info('✓ Message sent via serial');
            showToast('Message sent!', 'success');
        } catch (error) {
            logger.error('Serial send failed', error.message);
            showToast('Failed to send', 'error');
        }
    },
};

// ============================================================================
// TCP CONNECTION
// ============================================================================

const tcpConnection = {
    baseUrl: null,
    pollInterval: null,

    async connect() {
        const fullAddress = document.getElementById('tcpAddress').value;
        const [ip, port] = fullAddress.includes(':') ? fullAddress.split(':') : [fullAddress, '4403'];

        if (!ip) {
            showToast('Enter IP address', 'warning');
            return;
        }

        this.baseUrl = `http://${ip}:${port}`;
        logger.info(`Connecting to TCP: ${this.baseUrl}`);

        try {
            // Test connection
            const response = await fetch(`${this.baseUrl}/api/v1/device/config`);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            appState.tcpUrl = this.baseUrl;
            appState.connectionType = 'tcp';
            appState.isConnected = true;

            updateUIConnection();

            await this.sendHandshake();
            this.startPolling();

            showToast('TCP connected!', 'success');
        } catch (error) {
            logger.error('TCP connection failed', error.message);
            this.disconnect();
            showToast('TCP connection failed', 'error');
            throw error;
        }
    },

    async sendHandshake() {
        logger.debug('Sending TCP handshake (JSON API)...');
        try {
            // TCP API использует JSON-формат для отправки команд, кодированных Protobuf (в Base64)
            const configRequestEncoded = btoa(String.fromCharCode.apply(null, encodeToRadio({ wantConfigId: 0 })));

            await fetch(`${this.baseUrl}/api/v1/toradio`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ payload: configRequestEncoded }) // Отправляем как Base64
            });
            logger.info('✓ TCP handshake sent');
        } catch (error) {
            logger.error('TCP handshake failed', error.message);
        }
    },

    startPolling() {
        logger.debug('Starting TCP polling...');
        this.pollInterval = setInterval(async () => {
            try {
                // Fetching the binary Protobuf data
                const response = await fetch(`${this.baseUrl}/api/v1/fromradio`);
                if (response.ok) {
                    const data = await response.arrayBuffer();
                    if (data.byteLength > 0) {
                        logger.debug(`TCP received: ${data.byteLength} bytes`);
                        this.handleData(new Uint8Array(data));
                    }
                }
            } catch (error) {
                logger.warn('TCP poll error', error.message);
            }
        }, 1000);
    },

    handleData(data) {
        // ИСПОЛЬЗУЕМ Protobuf для декодирования
        decodeFromRadio(data);
    },

    async sendMessage(text) {
        logger.info(`Sending TCP message: "${text}"`);
        try {
            // Кодируем сообщение Protobuf, затем кодируем его в Base64 для JSON API
            const messagePayload = encodeToRadio({
                packet: {
                    decoded: {
                        portnum: PortNum.TEXT_MESSAGE_APP, // 1
                        payload: new TextEncoder().encode(text)
                    },
                    to: 0xFFFFFFFF
                }
            });
            
            const base64Payload = btoa(String.fromCharCode.apply(null, messagePayload));

            await fetch(`${this.baseUrl}/api/v1/toradio`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ payload: base64Payload })
            });
            logger.info('✓ TCP message sent (Base64 JSON)');
            showToast('Message sent!', 'success');
        } catch (error) {
            logger.error('TCP send failed', error.message);
            showToast('Failed to send', 'error');
        }
    },

    disconnect() {
        logger.info('Disconnecting TCP...');

        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }

        this.baseUrl = null;
        appState.isConnected = false;
        appState.connectionType = null;
        updateUIConnection();
        logger.info('✓ TCP disconnected');
        showToast('Disconnected', 'info');
    }
};


// ============================================================================
// UI EVENT LISTENERS
// ============================================================================

function switchTab(tabId) {
    document.querySelectorAll('.app-container > .tab-content').forEach(c => c.classList.remove('active'));
    document.querySelectorAll('.app-container > .tabs > .tab-button').forEach(b => b.classList.remove('active'));

    document.getElementById(tabId).classList.add('active');
    document.querySelector(`.app-container > .tabs > .tab-button[data-tab="${tabId}"]`).classList.add('active');
}

document.addEventListener('DOMContentLoaded', () => {
    // Top-level tabs
    document.querySelectorAll('.app-container > .tabs > .tab-button').forEach(button => {
        button.addEventListener('click', () => {
            const tabId = button.getAttribute('data-tab');
            switchTab(tabId);
            
            // For connection tab, explicitly show the default inner tab (ble-tab)
            if (tabId === 'connection') {
                 document.querySelector('#connection .tabs .tab-button[data-tab="ble-tab"]').classList.add('active');
                 document.getElementById('ble-tab').classList.add('active');
            }
        });
    });

    // Inner connection tabs
    document.querySelectorAll('#connection .tabs .tab-button').forEach(button => {
        button.addEventListener('click', () => {
            const tabId = button.getAttribute('data-tab');
            document.querySelectorAll('#connection .tab-content').forEach(c => c.classList.remove('active'));
            document.querySelectorAll('#connection .tabs .tab-button').forEach(b => b.classList.remove('active'));
            
            document.getElementById(tabId).classList.add('active');
            button.classList.add('active');
        });
    });
    
    // Connection Buttons
    document.getElementById('bleScanBtn').addEventListener('click', () => {
        bleConnection.connect().catch(e => {
            // Ошибка уже логируется внутри connect
        });
    });

    document.getElementById('bleDisconnectBtn').addEventListener('click', () => {
        bleConnection.disconnect();
    });

    document.getElementById('serialConnectBtn').addEventListener('click', () => {
        serialConnection.connect().catch(e => {
            // Ошибка уже логируется внутри connect
        });
    });

    document.getElementById('serialDisconnectBtn').addEventListener('click', () => {
        serialConnection.disconnect();
    });

    document.getElementById('tcpConnectBtn').addEventListener('click', () => {
        tcpConnection.connect().catch(e => {
            // Ошибка уже логируется внутри connect
        });
    });

    document.getElementById('tcpDisconnectBtn').addEventListener('click', () => {
        tcpConnection.disconnect();
    });

    // Send Message Button
    document.getElementById('sendMessageBtn').addEventListener('click', () => {
        const text = document.getElementById('messageText').value;
        if (!text || !appState.isConnected) {
            showToast("Not connected or message is empty.", 'warning');
            return;
        }
        
        if (appState.connectionType === 'ble') {
            bleConnection.sendMessage(text);
        } else if (appState.connectionType === 'serial') {
            serialConnection.sendMessage(text);
        } else if (appState.connectionType === 'tcp') {
            tcpConnection.sendMessage(text);
        }
        document.getElementById('messageText').value = ''; // Clear input
    });
    
    // Lora Slider update
    document.getElementById('txPower').addEventListener('input', (event) => {
        document.getElementById('txPowerValue').textContent = event.target.value;
    });

    // Admin/Log Buttons (Simplified)
    document.getElementById('clearLogsBtn').addEventListener('click', () => {
        document.getElementById('logConsole').innerHTML = '';
        showToast('Logs cleared', 'info');
    });

    document.getElementById('rebootDeviceBtn').addEventListener('click', () => {
        showToast('Reboot command sent (Not implemented in UI)', 'warning');
    });

    // Initial UI update
    updateUIConnection();
    updateUIInfo(); // Обновляем пустые поля при старте
});