-- Esquema de la agenda.
-- Todas las fechas se guardan en UTC (la app conecta con timezone 'Z').
--
-- 1) Como administrador (root), crea la base y un usuario solo para ella.
--    Cambia CAMBIA_ESTO por una contraseña propia y ponla en env/.env (DB_PASS).
--
--    CREATE DATABASE IF NOT EXISTS agenda CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
--    CREATE USER IF NOT EXISTS 'agenda'@'localhost' IDENTIFIED BY 'CAMBIA_ESTO';
--    GRANT SELECT, INSERT, UPDATE, DELETE ON agenda.* TO 'agenda'@'localhost';
--    FLUSH PRIVILEGES;
--
--    El usuario de la app no puede crear ni borrar tablas: solo leer y escribir datos.
--
-- 2) Crea las tablas (también como administrador):
--    mysql -u root -p agenda < db/schema.sql

CREATE TABLE IF NOT EXISTS citas (
  id                      INT UNSIGNED NOT NULL AUTO_INCREMENT,
  negocio                 VARCHAR(64)  NOT NULL,
  profesional             VARCHAR(64)  NOT NULL,
  servicio                VARCHAR(64)  NOT NULL,
  inicio                  DATETIME     NOT NULL COMMENT 'UTC',
  fin                     DATETIME     NOT NULL COMMENT 'UTC, fin que ve el cliente',
  fin_bloqueo             DATETIME     NOT NULL COMMENT 'UTC, fin + margen del servicio',
  cliente_nombre          VARCHAR(120) NOT NULL,
  cliente_telefono        VARCHAR(30)  NOT NULL,
  cliente_email           VARCHAR(254) NOT NULL,
  nota                    VARCHAR(500)     NULL,
  estado                  ENUM('confirmada', 'cancelada') NOT NULL DEFAULT 'confirmada',
  token_hash              CHAR(64)     NOT NULL COMMENT 'sha256(token + TOKEN_PEPPER) en hexadecimal',
  google_event_id         VARCHAR(1024)    NULL,
  privacidad_aceptada_at  DATETIME     NOT NULL COMMENT 'UTC',
  recordatorio_enviado_at DATETIME         NULL COMMENT 'UTC',
  creada_at               DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'UTC',
  PRIMARY KEY (id),
  UNIQUE KEY uq_citas_token_hash (token_hash),
  -- Solapes: "citas confirmadas de este profesional que empiezan antes de X y bloquean después de Y".
  KEY idx_citas_solapes (negocio, profesional, estado, inicio, fin_bloqueo),
  -- Recordatorios pendientes: confirmadas, sin recordatorio, ordenadas por inicio.
  KEY idx_citas_recordatorios (estado, recordatorio_enviado_at, inicio),
  CONSTRAINT chk_citas_orden CHECK (inicio < fin AND fin <= fin_bloqueo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS eventos (
  id        INT UNSIGNED NOT NULL AUTO_INCREMENT,
  cita_id   INT UNSIGNED NOT NULL,
  tipo      ENUM('creada', 'cambiada', 'cancelada', 'recordatorio', 'error_email', 'error_calendar', 'error_aviso') NOT NULL,
  detalle   JSON         NULL,
  creado_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'UTC',
  PRIMARY KEY (id),
  KEY idx_eventos_cita (cita_id, creado_at),
  CONSTRAINT fk_eventos_cita FOREIGN KEY (cita_id) REFERENCES citas (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
