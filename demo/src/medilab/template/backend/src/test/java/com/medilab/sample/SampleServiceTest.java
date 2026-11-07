package com.medilab.sample;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.medilab.common.ConflictException;
import com.medilab.order.CancelRequest;
import com.medilab.order.OrderService;
import com.medilab.order.OrderStatus;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@Transactional
class SampleServiceTest {

    @Autowired
    SampleService service;

    @Autowired
    OrderService orders;

    @Test
    void acceptingTheLastWaitingTubeStartsTheWork() {
        SampleView first = service.accept("LB00000855");
        assertThat(first.status()).isEqualTo(Sample.ACCETTATO);
        assertThat(first.orderStatus()).isEqualTo(OrderStatus.RICHIESTA);

        SampleView last = service.accept("LB00000856");
        assertThat(last.orderStatus()).isEqualTo(OrderStatus.IN_LAVORAZIONE);
        assertThat(last.examCodes()).containsExactly("GLU");
    }

    @Test
    void aTubeCannotBeAcceptedTwice() {
        assertThatThrownBy(() -> service.accept("LB00000840")).isInstanceOf(ConflictException.class);
    }

    @Test
    void aTubeOfACancelledRequestCannotBeAccepted() {
        orders.cancel("RL-2026-00061", new CancelRequest("Richiesta duplicata"));
        assertThatThrownBy(() -> service.accept("LB00000850")).isInstanceOf(ConflictException.class);
    }

    @Test
    void aRejectedTubeIsReplacedByANewOne() {
        SampleView rejected = service.reject("LB00000850", new RejectRequest("Emolizzato"));
        assertThat(rejected.status()).isEqualTo(Sample.RIFIUTATO);
        assertThat(rejected.rejectReason()).isEqualTo("Emolizzato");
        assertThat(rejected.replacedBy()).matches("LB\\d{8}");

        SampleView replacement = service.get(rejected.replacedBy());
        assertThat(replacement.status()).isEqualTo(Sample.ATTESO);
        assertThat(replacement.sampleType()).isEqualTo("SIERO");
        assertThat(service.accept(replacement.barcode()).orderStatus()).isEqualTo(OrderStatus.IN_LAVORAZIONE);
    }
}
