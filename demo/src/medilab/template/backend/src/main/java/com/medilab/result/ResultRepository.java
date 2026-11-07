package com.medilab.result;

import java.util.Collection;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ResultRepository extends JpaRepository<Result, Long> {

    List<Result> findByOrderId(String orderId);

    List<Result> findByOrderIdInAndValidatedTrue(Collection<String> orderIds);
}
