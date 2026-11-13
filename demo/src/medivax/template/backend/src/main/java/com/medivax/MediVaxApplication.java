package com.medivax;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/** MediVax: the vaccination centre's register of patients, vaccines, lots and doses. */
@SpringBootApplication
public class MediVaxApplication {

    public static void main(String[] args) {
        SpringApplication.run(MediVaxApplication.class, args);
    }
}
