/*
 * meshtastic_pb.js
 *
 * Минимальная рабочая заглушка, содержащая необходимые
 * определения Meshtastic Protobuf для устранения ошибки инициализации
 * и базовой работы ToRadio/FromRadio.
 * ДОЛЖНА БЫТЬ ЗАГРУЖЕНА ПОСЛЕ protobuf.min.js.
 */
(function(global) {
    if (typeof protobuf === 'undefined') {
        console.error("Protobuf library not loaded. Ensure protobuf.min.js is included before this file.");
        return;
    }
    
    // Создаем корневой объект для Meshtastic
    global.protobuf.roots["meshtastic"] = {};
    var meshtasticRoot = global.protobuf.roots["meshtastic"];

    // =========================================================================
    // ENUMS
    // =========================================================================

    // HardwareModel Enum (Необходим для устранения ошибки 'no such Enum meshtastic.HardwareModel')
    meshtasticRoot.HardwareModel = (function() {
        var valuesById = {}, values = {};
        valuesById[0] = values["UNSET"] = "UNSET";
        valuesById[1] = values["LORA"] = "LORA";
        valuesById[2] = values["NRF52840"] = "NRF52840";
        valuesById[3] = values["ESP32"] = "ESP32";
        valuesById[4] = values["TBEAM"] = "TBEAM";
        valuesById[5] = values["HELTEC"] = "HELTEC";
        valuesById[6] = values["HELTEC_V2"] = "HELTEC_V2";
        valuesById[7] = values["TBEAM_V07"] = "TBEAM_V07";
        valuesById[8] = values["TBEAM_V10"] = "TBEAM_V10";
        valuesById[9] = values["HELTEC_V21"] = "HELTEC_V21";
        valuesById[10] = values["T_ECHO"] = "T_ECHO";
        valuesById[11] = values["T_LORA_V1"] = "T_LORA_V1";
        valuesById[12] = values["T_LORA_V2"] = "T_LORA_V2";
        valuesById[13] = values["T_LORA_V21"] = "T_LORA_V21";
        valuesById[14] = values["HELTEC_V4"] = "HELTEC_V4"; // Heltec V4
        valuesById[15] = values["TBEAM_S3_CORE"] = "TBEAM_S3_CORE"; 
        return values;
    })();

    // Config.RegionCode Enum
    meshtasticRoot.Config = (function() {
        var Config = {};
        Config.RegionCode = (function() {
            var valuesById = {}, values = {};
            valuesById[0] = values["UNKNOWN"] = "UNKNOWN";
            valuesById[1] = values["US"] = "US";
            valuesById[2] = values["EU"] = "EU";
            valuesById[3] = values["JP"] = "JP";
            valuesById[9] = values["RU"] = "RU"; // Включен RU
            return values;
        })();
        return Config;
    })();

    // PortNum Enum (Для сообщений)
    meshtasticRoot.PortNum = (function() {
        var valuesById = {}, values = {};
        valuesById[0] = values["UNKNOWN_APP"] = "UNKNOWN_APP";
        valuesById[1] = values["TEXT_MESSAGE_APP"] = "TEXT_MESSAGE_APP";
        return values;
    })();

    // =========================================================================
    // MESSAGES (Минимальные классы для кодирования/декодирования)
    // =========================================================================

    // FromRadio Message (Получение данных от устройства)
    meshtasticRoot.FromRadio = (function() {
        var FromRadio = function FromRadio(properties) {
             // ...
        };

        FromRadio.decode = global.protobuf.Message.decode;
        
        // Объявляем минимальные поля, чтобы Protobuf мог их декодировать
        FromRadio.prototype.myNode = null;
        FromRadio.prototype.deviceMetrics = null;
        FromRadio.prototype.deviceMetadata = null;
        FromRadio.prototype.packet = null; // Для входящих сообщений

        return FromRadio;
    })();

    // ToRadio Message (Отправка команд на устройство)
    meshtasticRoot.ToRadio = (function() {
        var ToRadio = function ToRadio(properties) {
             // ...
        };

        ToRadio.encode = global.protobuf.Message.encode;
        
        // Объявляем минимальные поля
        ToRadio.prototype.wantConfigId = 0; // Для Handshake
        ToRadio.prototype.packet = null;     // Для отправки сообщений

        return ToRadio;
    })();
    
    // NodeInfo (для myNode)
    meshtasticRoot.NodeInfo = (function() {
        var NodeInfo = function NodeInfo(properties) { };
        NodeInfo.prototype.id = 0;
        NodeInfo.prototype.user = null;
        return NodeInfo;
    })();
    
    // User (для NodeInfo)
    meshtasticRoot.User = (function() {
        var User = function User(properties) { };
        User.prototype.longName = '';
        return User;
    })();
    
    // DeviceMetrics (для deviceMetrics)
    meshtasticRoot.DeviceMetrics = (function() {
        var DeviceMetrics = function DeviceMetrics(properties) { };
        DeviceMetrics.prototype.batteryLevel = 0;
        return DeviceMetrics;
    })();

    // DeviceMetadata (для deviceMetadata)
    meshtasticRoot.DeviceMetadata = (function() {
        var DeviceMetadata = function DeviceMetadata(properties) { };
        DeviceMetadata.prototype.firmwareVersion = '';
        DeviceMetadata.prototype.hwModel = 0; // Использует HardwareModel enum
        DeviceMetadata.prototype.region = 0;   // Использует Config.RegionCode enum
        return DeviceMetadata;
    })();
    
    // Data (для packet.decoded)
    meshtasticRoot.Data = (function() {
        var Data = function Data(properties) { };
        Data.prototype.portnum = 0;
        Data.prototype.payload = new Uint8Array(0);
        return Data;
    })();
    
    // MeshPacket (для packet)
    meshtasticRoot.MeshPacket = (function() {
        var MeshPacket = function MeshPacket(properties) { };
        MeshPacket.prototype.decoded = null;
        MeshPacket.prototype.to = 0;
        return MeshPacket;
    })();


})(this);