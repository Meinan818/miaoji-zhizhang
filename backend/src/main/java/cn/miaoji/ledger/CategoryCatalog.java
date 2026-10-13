package cn.miaoji.ledger;

import java.util.List;
import java.util.Map;

/** 与前端现用预设类别对应；同名“其他”由收支类型区分。 */
public final class CategoryCatalog {
    private CategoryCatalog() {}
    public static final Map<String, List<String>> OPTIONS = Map.of(
            "expense", List.of("餐饮", "交通", "购物", "娱乐", "住房", "医疗", "学习", "其他"),
            "income", List.of("工资", "红包", "兼职", "理财", "退款", "其他"));

    public static boolean contains(String type, String category) {
        return OPTIONS.getOrDefault(type, List.of()).contains(category);
    }
}
