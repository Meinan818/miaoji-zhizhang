package cn.miaoji.ledger;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.annotation.JsonDeserialize;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
import java.time.LocalDate;

public record RecordInput(
        @NotNull @Pattern(regexp = "income|expense") String type,
        @JsonDeserialize(using = MoneyStringDeserializer.class)
        @NotNull @Pattern(regexp = "(?:0|[1-9][0-9]{0,8})(?:\\.[0-9]{1,2})?") String amount,
        @NotNull LocalDate date,
        @NotBlank @Size(max = 32) String category,
        @NotNull @Size(max = 200) String note,
        @JsonInclude(JsonInclude.Include.NON_NULL)
        @Pattern(regexp = "(?:[01][0-9]|2[0-3]):[0-5][0-9]") String time) {
    public RecordInput(String type, String amount, LocalDate date, String category, String note) {
        this(type, amount, date, category, note, null);
    }
    public BigDecimal money() { return new BigDecimal(amount).setScale(2); }
}
