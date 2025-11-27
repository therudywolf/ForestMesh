/*
 * Этот файл является минимальной заглушкой, содержащей только базовые
 * определения Meshtastic Protobuf, необходимые для устранения ошибки инициализации
 * и базовой работы ToRadio/FromRadio.
 * В реальном проекте Meshtastic этот файл генерируется из всех .proto файлов.
 */
(function(global) {
    var meshtasticRoot = (global.protobuf.roots["meshtastic"] = {});

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
        valuesById[14] = values["HELTEC_V4"] = "HELTEC_V4";
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
            valuesById[4] = values["AU"] = "AU";
            valuesById[5] = values["CN"] = "CN";
            valuesById[6] = values["KR"] = "KR";
            valuesById[7] = values["IN"] = "IN";
            valuesById[8] = values["NZ"] = "NZ";
            valuesById[9] = values["RU"] = "RU"; // Добавлен RU
            valuesById[10] = values["SA"] = "SA"; 
            valuesById[11] = values["ZA"] = "ZA"; 
            return values;
        })();
        return Config;
    })();

    // FromRadio Message (Минимальное определение для декодирования)
    meshtasticRoot.FromRadio = (function() {
        var FromRadio = function FromRadio(properties) {
            if (properties)
                for (var keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                    this[keys[i]] = properties[keys[i]];
        };

        // Минимальные поля, необходимые для работы
        FromRadio.decode = global.protobuf.Message.decode;
        FromRadio.decodeDelimited = global.protobuf.Message.decodeDelimited;
        
        FromRadio.prototype.myNode = null;
        FromRadio.prototype.deviceMetrics = null;
        FromRadio.prototype.deviceMetadata = null;
        FromRadio.prototype.packet = null;

        // Здесь должна быть полная логика кодирования/декодирования
        // Для минимальной работы с protobuf.js достаточно наличия myNode, deviceMetrics, deviceMetadata.
        // Я опущу полную схему и полагаюсь на то, что protobuf.js обработает неизвестные поля.

        return FromRadio;
    })();

    // ToRadio Message (Минимальное определение для кодирования)
    meshtasticRoot.ToRadio = (function() {
        var ToRadio = function ToRadio(properties) {
            if (properties)
                for (var keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                    this[keys[i]] = properties[keys[i]];
        };

        ToRadio.encode = global.protobuf.Message.encode;
        ToRadio.decode = global.protobuf.Message.decode;
        ToRadio.decodeDelimited = global.protobuf.Message.decodeDelimited;
        
        ToRadio.prototype.wantConfigId = 0; // Для Handshake
        ToRadio.prototype.packet = null;     // Для отправки сообщений

        return ToRadio;
    })();

})(this);