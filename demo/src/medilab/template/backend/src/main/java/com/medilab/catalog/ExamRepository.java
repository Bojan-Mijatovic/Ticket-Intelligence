package com.medilab.catalog;

import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ExamRepository extends JpaRepository<Exam, String> {

    List<Exam> findByActiveTrueOrderBySampleTypeAscCodeAsc();

    List<Exam> findByActiveTrueAndNameContainingIgnoreCaseOrActiveTrueAndCodeContainingIgnoreCaseOrderBySampleTypeAscCodeAsc(String name, String code);
}
