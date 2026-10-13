package cn.miaoji.ledger;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.LocalDate;

public record RecordView(String id, String type, String amount, LocalDate date,
        String category, String note, long version,
        @JsonInclude(JsonInclude.Include.NON_NULL) String time) {}
