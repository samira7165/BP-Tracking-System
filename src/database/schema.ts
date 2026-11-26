/** Created automatically on first start. Works on MariaDB 10.4 (XAMPP), MySQL 8 and TiDB Cloud. */
const OPTIONS = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';

export const TABLES = [
  `CREATE TABLE IF NOT EXISTS scripts (
    id CHAR(36) NOT NULL PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    text MEDIUMTEXT NOT NULL,
    language VARCHAR(10) NULL COMMENT 'en, bn, or empty for auto-detect',
    active TINYINT(1) NOT NULL DEFAULT 1 COMMENT '1 = shown to brand promoters',
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
  ) ${OPTIONS}`,

  `CREATE TABLE IF NOT EXISTS recordings (
    id CHAR(36) NOT NULL PRIMARY KEY,
    bp_name VARCHAR(100) NULL COMMENT 'Brand promoter',
    script_id CHAR(36) NULL,
    script_title VARCHAR(200) NULL,
    status VARCHAR(20) NOT NULL COMMENT 'queued, extracting_audio, transcribing, analyzing, done, failed',
    verdict VARCHAR(20) NULL,
    overall_score TINYINT UNSIGNED NULL COMMENT '0-100',
    word_accuracy DECIMAL(5,2) NULL COMMENT 'percent',
    summary TEXT NULL,
    script_text MEDIUMTEXT NOT NULL COMMENT 'Copy, so later edits do not change old results',
    script_language VARCHAR(10) NULL,
    transcript MEDIUMTEXT NULL COMMENT 'What the brand promoter said',
    transcript_language VARCHAR(20) NULL,
    transcript_model VARCHAR(60) NULL,
    transcript_segments LONGTEXT NULL COMMENT 'JSON',
    duration_sec DECIMAL(9,2) NULL,
    report LONGTEXT NULL COMMENT 'Full report as JSON',
    error TEXT NULL,
    needs_retake TINYINT(1) NOT NULL DEFAULT 0,
    attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
    video_file VARCHAR(255) NOT NULL COMMENT 'File in the uploads folder',
    video_mime VARCHAR(100) NOT NULL,
    video_size BIGINT UNSIGNED NOT NULL,
    video_original_name VARCHAR(255) NOT NULL DEFAULT '',
    queued_at TIMESTAMP(3) NULL DEFAULT NULL,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    KEY idx_status (status),
    KEY idx_created (created_at),
    KEY idx_bp (bp_name),
    CONSTRAINT fk_recordings_script FOREIGN KEY (script_id) REFERENCES scripts (id) ON DELETE SET NULL
  ) ${OPTIONS}`,

  `CREATE TABLE IF NOT EXISTS settings (
    name VARCHAR(60) NOT NULL PRIMARY KEY,
    value MEDIUMTEXT NOT NULL,
    updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
  ) ${OPTIONS}`,
];
