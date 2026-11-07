package com.medilab.catalog;

import com.medilab.common.NotFoundException;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/exams")
public class ExamController {

    private final ExamRepository exams;

    public ExamController(ExamRepository exams) {
        this.exams = exams;
    }

    /** GET /api/exams?q=crea: active tests, by sample type and code; q matches the code or the name. */
    @GetMapping
    public List<Exam> list(@RequestParam(defaultValue = "") String q) {
        String term = q.trim();
        return term.isEmpty()
                ? exams.findByActiveTrueOrderBySampleTypeAscCodeAsc()
                : exams.findByActiveTrueAndNameContainingIgnoreCaseOrActiveTrueAndCodeContainingIgnoreCaseOrderBySampleTypeAscCodeAsc(term, term);
    }

    @GetMapping("/{code}")
    public Exam get(@PathVariable String code) {
        return exams.findById(code.toUpperCase()).orElseThrow(() -> new NotFoundException("Exam", code));
    }
}
