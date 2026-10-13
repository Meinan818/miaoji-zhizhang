package cn.miaoji.ledger;

import java.time.LocalDate;

public record RecordFilters(LocalDate start, LocalDate end, String type, String category,
        LocalDate date, String query) {}
