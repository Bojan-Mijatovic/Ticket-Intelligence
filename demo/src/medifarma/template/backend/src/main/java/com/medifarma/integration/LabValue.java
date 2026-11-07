package com.medifarma.integration;

import java.math.BigDecimal;
import java.time.LocalDateTime;

/** A validated laboratory result read from MediLab: the value in `unit`, when it was reported, and its request. */
public record LabValue(BigDecimal value, String unit, LocalDateTime reportedAt, String orderId) {}
