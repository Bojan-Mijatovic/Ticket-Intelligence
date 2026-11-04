CREATE TABLE structures (
  id   VARCHAR(40) PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  city VARCHAR(60)  NOT NULL
);

CREATE TABLE resources (
  code         VARCHAR(40) PRIMARY KEY,
  description  VARCHAR(120) NOT NULL,
  structure_id VARCHAR(40)  NOT NULL REFERENCES structures (id),
  active       BOOLEAN      NOT NULL DEFAULT TRUE
);

CREATE TABLE time_slots (
  id                BIGINT PRIMARY KEY,
  agenda_name       VARCHAR(120) NOT NULL,
  slot_code         VARCHAR(40)  NOT NULL,
  start_date        DATE         NOT NULL,
  end_date          DATE         NOT NULL,
  frequency         VARCHAR(80)  NOT NULL,
  weekday           VARCHAR(20)  NOT NULL,
  start_time        TIME         NOT NULL,
  end_time          TIME         NOT NULL,
  priority          VARCHAR(40)  NOT NULL,
  priority_rank     INT          NOT NULL,
  calendar_end_date DATE         NOT NULL,
  resource_code     VARCHAR(40)  NOT NULL REFERENCES resources (code),
  structure_id      VARCHAR(40)  NOT NULL REFERENCES structures (id)
);
