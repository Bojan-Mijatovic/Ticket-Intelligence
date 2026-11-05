package com.mediagenda.timeslot;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.LocalDate;
import java.time.LocalTime;

/** A recurring time slot ("fascia oraria") of a provider's agenda. */
@Entity
@Table(name = "time_slots")
public class TimeSlot {

    @Id
    private Long id;
    @Column(name = "agenda_name")
    private String agendaName;
    @Column(name = "slot_code")
    private String slotCode;
    @Column(name = "start_date")
    private LocalDate startDate;
    @Column(name = "end_date")
    private LocalDate endDate;
    private String frequency;
    private String weekday;
    @Column(name = "start_time")
    private LocalTime startTime;
    @Column(name = "end_time")
    private LocalTime endTime;
    private String priority;
    @Column(name = "priority_rank")
    private int priorityRank;
    @Column(name = "calendar_end_date")
    private LocalDate calendarEndDate;
    @Column(name = "resource_code")
    private String resourceCode;
    @Column(name = "structure_id")
    private String structureId;

    protected TimeSlot() {}

    /** A new recurring slot, created from the "Nuova fascia oraria" form (CUP_DEMO-2590). */
    static TimeSlot create(Long id, String agendaName, String slotCode, LocalDate startDate, LocalDate endDate, String frequency,
                           String weekday, LocalTime startTime, LocalTime endTime, String priority, int priorityRank,
                           LocalDate calendarEndDate, String resourceCode, String structureId) {
        TimeSlot t = new TimeSlot();
        t.id = id;
        t.agendaName = agendaName;
        t.slotCode = slotCode;
        t.startDate = startDate;
        t.endDate = endDate;
        t.frequency = frequency;
        t.weekday = weekday;
        t.startTime = startTime;
        t.endTime = endTime;
        t.priority = priority;
        t.priorityRank = priorityRank;
        t.calendarEndDate = calendarEndDate;
        t.resourceCode = resourceCode;
        t.structureId = structureId;
        return t;
    }

    public Long getId() { return id; }
    public String getAgendaName() { return agendaName; }
    public String getSlotCode() { return slotCode; }
    public LocalDate getStartDate() { return startDate; }
    public LocalDate getEndDate() { return endDate; }
    public String getFrequency() { return frequency; }
    public String getWeekday() { return weekday; }
    public LocalTime getStartTime() { return startTime; }
    public LocalTime getEndTime() { return endTime; }
    public String getPriority() { return priority; }
    public int getPriorityRank() { return priorityRank; }
    public LocalDate getCalendarEndDate() { return calendarEndDate; }
    public String getResourceCode() { return resourceCode; }
    public String getStructureId() { return structureId; }
}
