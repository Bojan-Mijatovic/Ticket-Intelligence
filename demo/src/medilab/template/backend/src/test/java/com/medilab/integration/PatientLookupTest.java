package com.medilab.integration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.medilab.common.PeerUnavailableException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
class PatientLookupTest {

    @Autowired
    MockMvc mvc;

    @Autowired
    FakeMediAgendaClient mediAgenda;

    @AfterEach
    void up() {
        mediAgenda.down = false;
    }

    @Test
    void searchesTheMediAgendaRegistry() throws Exception {
        mvc.perform(get("/api/mediagenda/patients").param("q", "ross"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].fiscalCode").value("RSSMRA80A01F205X"));
        assertThat(mediAgenda.search("zzz")).isEmpty();
    }

    @Test
    void theHttpClientReportsAMediAgendaThatDoesNotAnswer() {
        HttpMediAgendaClient client = new HttpMediAgendaClient("http://localhost:1", 500); // nothing listens on port 1
        assertThatThrownBy(() -> client.patient(1)).isInstanceOf(PeerUnavailableException.class).hasMessageContaining("MediAgenda");
    }

    @Test
    void mediAgendaNotAnsweringIsA502WithAMessage() throws Exception {
        mediAgenda.down = true;
        mvc.perform(get("/api/mediagenda/patients").param("q", "ross"))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.details[0]").value(org.hamcrest.Matchers.containsString("MediAgenda is not reachable")));
    }
}
