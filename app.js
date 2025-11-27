// Глобальные константы и заглушки (для упрощения, в реальном проекте должны быть в другом файле)
const BLE_SERVICE_UUID = '42f9a997-c100-4b2e-80c1-3d7729f28d84';
const TORADIO_UUID = '42f9a997-c100-4b2e-80c1-3d7729f28d85';
const FROMRADIO_UUID = '42f9a997-c100-4b2e-80c1-3d7729f28d86';
const FROMNUM_UUID = '42f9a997-c100-4b2e-80c1-3d7729f28d87';

// Заглушка для logger (имитирует реальный logger)
const logger = {
    _log(level, ...args) {
        const timestamp = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const message = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : a)).join(' ');
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

// Заглушка для Toast
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

// Заглушка для App State и UI
const appState = {
    isConnected: false,
    connectionType: null,
    deviceInfo: {},
    loraConfig: {},
    // ... остальное состояние
};

function updateUIConnection() {
    const statusBadge = document.getElementById('connectionStatus');
    const statusText = document.getElementById('statusText');
    const connectBtns = document.querySelectorAll('#bleScanBtn, #serialConnectBtn, #tcpConnectBtn');
    const disconnectBtns = document.querySelectorAll('#bleDisconnectBtn, #serialDisconnectBtn, #tcpDisconnectBtn');

    statusBadge.className = 'status-badge ' + (appState.isConnected ? 'connected' : 'disconnected');
    statusText.textContent = appState.isConnected ? `Connected (${appState.connectionType.toUpperCase()})` : 'Disconnected';

    connectBtns.forEach(btn => btn.disabled = appState.isConnected);
    disconnectBtns.forEach(btn => btn.disabled = !appState.isConnected);
}

function updateUIInfo() {
    document.getElementById('nodeId').textContent = appState.deviceInfo.nodeId || '-';
    document.getElementById('hwModel').textContent = appState.deviceInfo.hwModel || '-';
    document.getElementById('fwVersion').textContent = appState.deviceInfo.firmwareVersion || '-';
    document.getElementById('region').textContent = appState.deviceInfo.region || '-';
    // Обновление других полей...
}

// ============================================================================
// MESHTASTIC PROTOBUF HELPERS (ДОБАВЛЕНА РЕАЛЬНАЯ ЛОГИКА)
// ============================================================================

const meshtasticRoot = protobuf.roots.meshtastic;
const ToRadio = meshtasticRoot.ToRadio;
const FromRadio = meshtasticRoot.FromRadio;
const Config = meshtasticRoot.Config;
const HardwareModel = meshtasticRoot.HardwareModel;

function decodeFromRadio(data) {
    try {
        const decoded = FromRadio.decode(data);
        const json = decoded.toJSON();
        logger.info(`Protobuf decoded successfully. Device: ${json.myNode.id}`, json);

        // Обновление состояния из реальных данных
        if (json.myNode) {
            appState.deviceInfo.nodeId = json.myNode.id.toString(16).padStart(8, '0');
        }
        if (json.deviceMetrics) {
            appState.deviceInfo.battery = `${json.deviceMetrics.batteryLevel}%`;
        }
        if (json.myNode.user.longName) {
            appState.deviceInfo.channelName = json.myNode.user.longName;
        }
        if (json.deviceMetadata) {
            appState.deviceInfo.firmwareVersion = json.deviceMetadata.firmwareVersion || 'N/A';
            appState.deviceInfo.hwModel = HardwareModel.valuesById[json.deviceMetadata.hwModel] || 'UNKNOWN';
            appState.deviceInfo.region = Config.RegionCode.valuesById[json.deviceMetadata.region] || 'N/A';
        }
        updateUIInfo();

        // Проверка наличия пакетов для предотвращения логов "invalid wire type"
        if (json.packet) {
            logger.info(`Received packet: ${json.packet.decoded.payload}`);
        }

        return json;
    } catch (error) {
        logger.error('Protobuf DECODE failed:', error.message);
        logger.error('Data that caused error:', Array.from(data).map(b => b.toString(16).padStart(2, '0')).join(' '));
        return null;
    }
}

function encodeToRadio(payload) {
    try {
        const message = ToRadio.create(payload);
        const encoded = ToRadio.encode(message).finish();
        return encoded;
    } catch (error) {
        logger.error('Protobuf ENCODE failed:', error.message);
        throw error;
    }
}

// ============================================================================
// BLE CONNECTION
// ============================================================================

const bleConnection = {
    // ... (unchanged properties)
    device: null,
    server: null,
    service: null,
    toRadio: null,
    fromRadio: null,
    fromNum: null,
    reader: null,
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

            // Connect to GATT server
            logger.debug('Connecting to GATT server...');
            this.server = await this.device.gatt.connect();
            logger.info('✓ GATT server connected');

            // Get Meshtastic service
            logger.debug('Getting Meshtastic service...');
            this.service = await this.server.getPrimaryService(BLE_SERVICE_UUID);
            logger.info('✓ Meshtastic service found');

            // Get characteristics
            logger.debug('Getting characteristics...');
            this.toRadio = await this.service.getCharacteristic(TORADIO_UUID);
            this.fromRadio = await this.service.getCharacteristic(FROMRADIO_UUID);
            this.fromNum = await this.service.getCharacteristic(FROMNUM_UUID);
            logger.info('✓ All characteristics acquired');

            // Start notifications
            logger.debug('Starting notifications...');
            await this.fromRadio.startNotifications();
            this.fromRadio.addEventListener('characteristicvaluechanged', (event) => {
                this.handleFromRadioData(event.target.value);
            });
            logger.info('✓ Notifications started');

            appState.device = this.device;
            appState.server = this.server;
            appState.service = this.service;
            appState.characteristics = {
                toRadio: this.toRadio,
                fromRadio: this.fromRadio,
                fromNum: this.fromNum
            };
            appState.connectionType = 'ble';
            appState.isConnected = true;

            updateUIConnection();
            logger.info('✓ BLE connection established');

            // Send handshake
            await this.sendHandshake();

            // Start reading (BLE uses notifications, but keep loop for fromNum if needed)
            // this.startReading();

            showToast('BLE connected successfully!', 'success');
        } catch (error) {
            logger.error('BLE connection failed', error.message);
            this.disconnect();
            showToast('BLE connection failed', 'error');
            throw error;
        }
    },

    async sendHandshake() {
        logger.debug('Sending handshake (want_config_id)...');
        try {
            // Использование Protobuf для создания ToRadio сообщения с wantConfigId = 0
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
        logger.debug(`Received ${data.length} bytes from device`);

        const hex = Array.from(data).map(b => b.toString(16).padStart(2, '0')).join(' ');
        logger.debug(`RAW: ${hex}`);

        // Используем реальную функцию декодирования Protobuf
        const decoded = decodeFromRadio(data);

        if (decoded) {
            logger.info(`Packet received: ${data.length} bytes`);
            // UI update handled inside decodeFromRadio if device info is present
        }
    },

    // startReading - закомментирован, так как BLE использует notifications

    async sendMessage(text, destination = 0xFFFFFFFF) {
        logger.info(`Sending message: "${text}" to ${destination.toString(16)}`);
        try {
            // Protobuf message encoding (упрощенно, требует полной структуры)
            const messagePayload = encodeToRadio({
                // Это неполная структура, но демонстрирует Protobuf
                packet: {
                    decoded: {
                        portnum: 1, // TEXT_MESSAGE_APP
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

    disconnect() {
        logger.info('Disconnecting BLE...');
        this.isReading = false;

        if (this.device && this.device.gatt.connected) {
            this.device.gatt.disconnect();
        }

        this.device = null;
        this.server = null;
        this.service = null;
        this.toRadio = null;
        this.fromRadio = null;
        this.fromNum = null;

        appState.isConnected = false;
        appState.connectionType = null;
        updateUIConnection();
        logger.info('✓ BLE disconnected');
        showToast('Disconnected', 'info');
    }
};

// ============================================================================
// SERIAL CONNECTION
// ============================================================================

const serialConnection = {
    port: null,
    reader: null,
    writer: null,
    isReading: false,
    // Note: Serial needs proper frame handling (e.g., SLIP) which is omitted here.
    // Assuming simple text for now, but will handle binary Protobuf output.

    async connect() {
        logger.info('Opening serial port...');
        try {
            if (!('serial' in navigator)) {
                throw new Error('Web Serial API not supported');
            }

            // Request port
            this.port = await navigator.serial.requestPort();
            logger.info('✓ Serial port selected');

            // Open with baudrate
            await this.port.open({ baudRate: 115200 });
            logger.info('✓ Serial port opened at 115200 baud');

            // Get streams
            // For Meshtastic, we must use raw binary data, not TextDecoderStream
            this.reader = this.port.readable.getReader();
            this.writer = this.port.writable.getWriter();

            appState.serialPort = this.port;
            appState.serialReader = this.reader;
            appState.connectionType = 'serial';
            appState.isConnected = true;

            updateUIConnection();
            logger.info('✓ Serial connection established');

            // Send handshake
            await this.sendHandshake();

            // Start reading
            this.startReading();

            showToast('Serial connected!', 'success');
        } catch (error) {
            // ИСПРАВЛЕНИЕ: Ошибка Serial connection failed logger.success is not a function устранена
            logger.error('Serial connection failed', error.message);
            this.disconnect();
            showToast('Serial connection failed', 'error');
            throw error;
        }
    },

    async sendHandshake() {
        logger.debug('Sending serial handshake...');
        try {
            // Использование Protobuf для создания ToRadio сообщения с wantConfigId = 0
            const configRequest = encodeToRadio({
                wantConfigId: 0
            });
            // Serial/USB часто использует SLIP или другой протокол,
            // но мы просто отправляем сырой Protobuf-пакет для минимальной демонстрации.
            // В реальном проекте здесь требуется кодирование в SLIP.

            await this.writer.write(configRequest);
            logger.info(`✓ Serial handshake sent: ${configRequest.length} bytes`);
        } catch (error) {
            logger.error('Serial handshake failed', error.message);
        }
    },

    async startReading() {
        this.isReading = true;
        logger.debug('Starting serial read loop...');

        try {
            while (this.isReading) {
                const { value, done } = await this.reader.read();
                if (done) {
                    logger.warn('Serial stream closed');
                    break;
                }

                if (value && value.length > 0) {
                    // В реальном проекте здесь должна быть логика декодирования SLIP (Serial Line IP)
                    // Для примера, декодируем как сырой Protobuf пакет
                    this.handleData(value);
                }
            }
        } catch (error) {
            if (this.isReading) {
                logger.error('Serial read error', error.message);
            }
        }
    },

    handleData(data) {
        logger.debug(`Serial received: ${data.length} bytes`);
        // Используем реальную функцию декодирования Protobuf
        decodeFromRadio(data);
    },

    async sendMessage(text) {
        logger.info(`Sending message via serial: "${text}"`);
        try {
            // Создаем Protobuf сообщение для отправки
            const messagePayload = encodeToRadio({
                packet: {
                    decoded: {
                        portnum: 1, // TEXT_MESSAGE_APP
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

    async disconnect() {
        logger.info('Closing serial port...');
        this.isReading = false;

        try {
            if (this.reader) {
                await this.reader.cancel();
                await this.reader.releaseLock();
            }
            if (this.writer) {
                // await this.writer.close(); // Causes errors in some browsers
                this.writer.releaseLock();
            }
            if (this.port) {
                await this.port.close();
            }
        } catch (error) {
            logger.warn('Error during serial disconnect', error.message);
        }

        this.port = null;
        this.reader = null;
        this.writer = null;

        appState.isConnected = false;
        appState.connectionType = null;
        updateUIConnection();
        logger.info('✓ Serial disconnected');
        showToast('Disconnected', 'info');
    }
};

// ============================================================================
// TCP CONNECTION
// ============================================================================

const tcpConnection = {
    baseUrl: null,
    pollInterval: null,

    async connect() {
        const fullAddress = document.getElementById('tcpAddress').value;
        let ip, port;

        if (fullAddress.includes(':')) {
            [ip, port] = fullAddress.split(':');
        } else {
            ip = fullAddress;
            port = '4403'; // Default Meshtastic-MQTT-Client port
        }

        if (!ip) {
            showToast('Enter IP address', 'warning');
            return;
        }

        this.baseUrl = `http://${ip}:${port}`;
        logger.info(`Connecting to TCP: ${this.baseUrl}`);

        try {
            // Test connection by fetching config
            const response = await fetch(`${this.baseUrl}/api/v1/device/config`);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            // In a real implementation, you would check if response is valid JSON Meshtastic data
            logger.info('✓ TCP connection test successful');

            appState.tcpUrl = this.baseUrl;
            appState.connectionType = 'tcp';
            appState.isConnected = true;

            updateUIConnection();

            // Send handshake (Request config)
            await this.sendHandshake();

            // Start polling
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
        logger.debug('Sending TCP handshake...');
        try {
            // TCP API использует JSON. Нет необходимости в Protobuf для Handshake.
            await fetch(`${this.baseUrl}/api/v1/toradio`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ wantConfigId: 0 })
            });
            logger.info('✓ TCP handshake sent (JSON: wantConfigId: 0)');
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
                        logger.debug(`TCP received ${data.byteLength} bytes`);
                        this.handleData(new Uint8Array(data));
                    }
                }
            } catch (error) {
                logger.warn('TCP poll error', error.message);
            }
        }, 1000);
    },

    handleData(data) {
        logger.debug(`TCP packet: ${data.length} bytes`);
        // Используем реальную функцию декодирования Protobuf
        decodeFromRadio(data);
    },

    async sendMessage(text) {
        logger.info(`Sending TCP message: "${text}"`);
        try {
            // TCP API использует JSON.
            await fetch(`${this.baseUrl}/api/v1/toradio`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    packet: {
                        decoded: {
                            portnum: 1, // TEXT_MESSAGE_APP
                            payload: btoa(text) // Base64-кодировка payload
                        }
                    }
                })
            });
            logger.info('✓ TCP message sent (JSON)');
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

// Utility function for managing tabs (existing logic)
function switchTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));

    document.getElementById(tabId).classList.add('active');
    document.querySelector(`.tab-button[data-tab="${tabId}"]`).classList.add('active');
}

// Initializers
document.addEventListener('DOMContentLoaded', () => {
    // Top-level tabs
    document.querySelectorAll('.tabs:first-child .tab-button').forEach(button => {
        button.addEventListener('click', () => {
            const tabId = button.getAttribute('data-tab');
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            document.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
            
            // This is messy because of nested tabs, let's fix only the top level
            if (tabId === 'connection') {
                 // For connection tab, explicitly show the default inner tab (ble-tab)
                 switchTab('connection');
                 document.querySelector('.tab-button[data-tab="ble-tab"]').classList.add('active');
                 document.getElementById('ble-tab').classList.add('active');
            } else {
                 switchTab(tabId);
            }
        });
    });

    // Inner connection tabs
    document.querySelectorAll('#connection .tabs .tab-button').forEach(button => {
        button.addEventListener('click', () => {
            const tabId = button.getAttribute('data-tab');
            document.querySelectorAll('#connection .tab-content').forEach(c => c.classList.remove('active'));
            document.querySelectorAll('#connection .tab-button').forEach(b => b.classList.remove('active'));
            
            document.getElementById(tabId).classList.add('active');
            button.classList.add('active');
        });
    });
    
    // Connection Buttons
    document.getElementById('bleScanBtn').addEventListener('click', () => {
        bleConnection.connect().catch(e => logger.error("BLE Connect failed after scan", e));
    });

    document.getElementById('bleDisconnectBtn').addEventListener('click', () => {
        bleConnection.disconnect();
    });

    document.getElementById('serialConnectBtn').addEventListener('click', () => {
        serialConnection.connect().catch(e => logger.error("Serial Connect failed", e));
    });

    document.getElementById('serialDisconnectBtn').addEventListener('click', () => {
        serialConnection.disconnect();
    });

    document.getElementById('tcpConnectBtn').addEventListener('click', () => {
        tcpConnection.connect().catch(e => logger.error("TCP Connect failed", e));
    });

    document.getElementById('tcpDisconnectBtn').addEventListener('click', () => {
        tcpConnection.disconnect();
    });

    // Send Message Button
    document.getElementById('sendMessageBtn').addEventListener('click', () => {
        const text = document.getElementById('messageText').value;
        if (!text || !appState.isConnected) return;
        
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
        showToast('Reboot command sent (Not implemented)', 'warning');
    });

    // Initial UI update
    updateUIConnection();
});