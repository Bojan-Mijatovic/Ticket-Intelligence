package com.medifarma.safety;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

/** Two active ingredients that should not be given together (or only with care), and why. */
@Entity
@Table(name = "interaction_rules")
public class InteractionRule {

    @Id
    private Long id;
    @Column(name = "ingredient_a")
    private String ingredientA;
    @Column(name = "ingredient_b")
    private String ingredientB;
    private String severity;
    private String note;

    protected InteractionRule() {}

    /** Whether the rule is about these two ingredients, in either order. */
    public boolean matches(String first, String second) {
        return (ingredientA.equalsIgnoreCase(first) && ingredientB.equalsIgnoreCase(second))
                || (ingredientA.equalsIgnoreCase(second) && ingredientB.equalsIgnoreCase(first));
    }

    public Long getId() { return id; }
    public String getIngredientA() { return ingredientA; }
    public String getIngredientB() { return ingredientB; }
    public String getSeverity() { return severity; }
    public String getNote() { return note; }
}
