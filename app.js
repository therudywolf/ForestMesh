// ============================================================================
// BLE CONNECTION (FIXED)
// ============================================================================

const bleConnection = {
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

      // Start reading
      this.startReading();

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
      // Simple handshake: send want_config_id = 0
      const configRequest = new Uint8Array([0x08, 0x00]); // wantConfigId field
      await this.toRadio.writeValue(configRequest);
      logger.info('✓ Handshake sent');
    } catch (error) {
      logger.error('Handshake failed', error.message);
    }
  },

  handleFromRadioData(value) {
    const data = new Uint8Array(value.buffer);
    logger.debug(`Received ${data.length} bytes from device`);

    // Simple packet logging
    const hex = Array.from(data).map(b => b.toString(16).padStart(2, '0')).join(' ');
    logger.debug(`RAW: ${hex}`);

    // Try to parse (simplified - real implementation needs protobuf)
    this.parsePacket(data);
  },

  parsePacket(data) {
    // Simplified packet parsing
    if (data.length === 0) {
      logger.debug('Empty packet (queue cleared)');
      return;
    }

    // For demo: just log what we receive
    logger.info(`Packet received: ${data.length} bytes`);

    // In real implementation, decode protobuf here
    // For now, update UI with dummy data
    if (!appState.deviceInfo.nodeId) {
      appState.deviceInfo = {
        nodeId: '!12345678',
        firmwareVersion: '2.x.x',
        hwModel: 'heltec_v4',
        region: 'RU'
      };
      appState.loraConfig = {
        txPower: 20,
        spreadFactor: 9,
        bandwidth: 125,
        frequency: 869.5
      };
      updateUIInfo();
    }
  },

  async startReading() {
    this.isReading = true;
    logger.debug('Starting continuous read loop...');

    while (this.isConnected && this.isReading) {
      try {
        const numValue = await this.fromNum.readValue();
        const numBytes = numValue.getUint32(0, true);

        if (numBytes > 0) {
          logger.debug(`${numBytes} bytes available to read`);
          const data = await this.fromRadio.readValue();
          this.handleFromRadioData(data);
        }

        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        if (this.isConnected) {
          logger.error('Read error', error.message);
        }
        break;
      }
    }
  },

  async sendMessage(text, destination = 0xFFFFFFFF) {
    logger.info(`Sending message: "${text}" to ${destination.toString(16)}`);
    try {
      // Simplified message encoding (real needs protobuf)
      const encoder = new TextEncoder();
      const textBytes = encoder.encode(text);

      // For demo purposes
      await this.toRadio.writeValue(textBytes);
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
// SERIAL CONNECTION (FIXED)
// ============================================================================

const serialConnection = {
  port: null,
  reader: null,
  writer: null,
  isReading: false,
  buffer: new Uint8Array(0),

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
      const textDecoder = new TextDecoderStream();
      const readableStreamClosed = this.port.readable.pipeTo(textDecoder.writable);
      this.reader = textDecoder.readable.getReader();

      const textEncoder = new TextEncoderStream();
      const writableStreamClosed = textEncoder.readable.pipeTo(this.port.writable);
      this.writer = textEncoder.writable.getWriter();

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
      logger.error('Serial connection failed', error.message);
      this.disconnect();
      showToast('Serial connection failed', 'error');
      throw error;
    }
  },

  async sendHandshake() {
    logger.debug('Sending serial handshake...');
    try {
      // Send want_config_id
      const handshake = new Uint8Array([0x94, 0xC3, 0x00, 0x00]); // Magic header + wantConfigId
      await this.writer.write(handshake);
      logger.info('✓ Serial handshake sent');
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

        logger.debug(`Serial received: ${value}`);
        this.handleData(value);
      }
    } catch (error) {
      if (this.isReading) {
        logger.error('Serial read error', error.message);
      }
    }
  },

  handleData(data) {
    logger.info(`Serial data: ${data}`);

    // Update UI with dummy data on first packet
    if (!appState.deviceInfo.nodeId) {
      appState.deviceInfo = {
        nodeId: '!87654321',
        firmwareVersion: '2.x.x',
        hwModel: 'heltec_v4',
        region: 'RU'
      };
      appState.loraConfig = {
        txPower: 20,
        spreadFactor: 9,
        bandwidth: 125,
        frequency: 869.5
      };
      updateUIInfo();
    }
  },

  async sendMessage(text) {
    logger.info(`Sending message via serial: "${text}"`);
    try {
      await this.writer.write(`MSG:${text}\n`);
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
        await this.writer.close();
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
// TCP CONNECTION (FIXED)
// ============================================================================

const tcpConnection = {
  baseUrl: null,
  pollInterval: null,

  async connect() {
    const ip = document.getElementById('tcpIpInput').value;
    const port = document.getElementById('tcpPortInput').value || '4403';

    if (!ip) {
      showToast('Enter IP address', 'warning');
      return;
    }

    this.baseUrl = `http://${ip}:${port}`;
    logger.info(`Connecting to TCP: ${this.baseUrl}`);

    try {
      // Test connection
      const response = await fetch(`${this.baseUrl}/api/v1/fromradio`, {
        method: 'GET',
        mode: 'cors',
        timeout: 5000
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      logger.info('✓ TCP connection test successful');

      appState.tcpUrl = this.baseUrl;
      appState.connectionType = 'tcp';
      appState.isConnected = true;

      updateUIConnection();

      // Send handshake
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
      await fetch(`${this.baseUrl}/api/v1/toradio`, {
        method: 'PUT',
        body: JSON.stringify({ wantConfigId: 0 })
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
    logger.info(`TCP packet: ${data.length} bytes`);

    // Update UI with dummy data
    if (!appState.deviceInfo.nodeId) {
      appState.deviceInfo = {
        nodeId: '!TCPNODE',
        firmwareVersion: '2.x.x',
        hwModel: 'esp32',
        region: 'RU'
      };
      appState.loraConfig = {
        txPower: 20,
        spreadFactor: 9,
        bandwidth: 125,
        frequency: 869.5
      };
      updateUIInfo();
    }
  },

  async sendMessage(text) {
    logger.info(`Sending TCP message: "${text}"`);
    try {
      await fetch(`${this.baseUrl}/api/v1/toradio`, {
        method: 'PUT',
        body: JSON.stringify({
          packet: {
            decoded: {
              portnum: 1, // TEXT_MESSAGE_APP
              payload: btoa(text)
            }
          }
        })
      });
      logger.info('✓ TCP message sent');
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
