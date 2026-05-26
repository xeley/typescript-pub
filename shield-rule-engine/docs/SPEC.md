# Shield Rule Engine — Specification (Gherkin)

> Executable specification for the Shield Rule Engine, derived from
> [`REQUIREMENTS.md`](./REQUIREMENTS.md). Each `Feature` covers one capability
> and is intended to be runnable under a Gherkin-compatible BDD runner
> (Cucumber, SpecFlow, behave, etc.).

---

## Feature: Rule authoring in the UI

```gherkin
Feature: Rule authoring in the UI
  As a fraud/risk analyst
  I want to write rules in a human-readable DSL
  So that I can change risk policy without engineering involvement

  Background:
    Given I am signed in as a fraud analyst for tenant "acme"
    And I am on the Shield rule editor

  Scenario: Author a valid MCC + country rule
    When I enter the rule:
      """
      IF MCC in {5999, 4829} AND country != US THEN DECLINE
      """
    And I request validation
    Then the rule is reported as valid
    And the parsed action is "DECLINE"

  Scenario: Reject a syntactically invalid rule
    When I enter the rule:
      """
      IF MCC in 5999, 4829 country != US THEN DECLINE
      """
    And I request validation
    Then the rule is reported as invalid
    And the error points to the missing "{" after "in"

  Scenario: Reject an unknown field
    When I enter the rule:
      """
      IF wallet_color = "blue" THEN DECLINE
      """
    And I request validation
    Then the rule is reported as invalid
    And the error names the unknown field "wallet_color"

  Scenario: Reject an unknown action
    When I enter the rule:
      """
      IF CVV failed THEN EXPLODE
      """
    And I request validation
    Then the rule is reported as invalid
    And the error names the unknown action "EXPLODE"
```

---

## Feature: Rule compilation

```gherkin
Feature: Rule compilation
  As the platform
  I want to compile authored rules into a safe executable form
  So that evaluation at auth time is fast and cannot run unsafe code

  Scenario: Compile a valid ruleset
    Given a draft ruleset for tenant "acme" containing:
      | rule                                                       |
      | IF MCC in {5999, 4829} AND country != US THEN DECLINE      |
      | IF CVV failed AND card_not_present THEN LOCK               |
      | IF count(card, 10 min) > 5 THEN WARM                       |
    When I compile the ruleset
    Then compilation succeeds
    And a compiled artifact is produced
    And the artifact references only whitelisted fields and functions

  Scenario: Refuse to compile an unsafe expression
    Given a draft ruleset for tenant "acme" containing:
      | rule                                |
      | IF eval("os.exit()") THEN DECLINE   |
    When I compile the ruleset
    Then compilation fails
    And the failure reason is "unsafe expression"
    And no artifact is produced

  Scenario: Refuse to compile a runaway aggregate window
    Given a draft ruleset for tenant "acme" containing:
      | rule                                       |
      | IF count(card, 10 years) > 5 THEN DECLINE  |
    When I compile the ruleset
    Then compilation fails
    And the failure reason mentions the unsupported window "10 years"
```

---

## Feature: Publishing a ruleset

```gherkin
Feature: Publishing a ruleset
  As a fraud/risk lead
  I want to publish compiled rulesets atomically
  So that evaluation always uses a known-good, versioned ruleset

  Background:
    Given tenant "acme" has a compiled ruleset version 7 currently active

  Scenario: Publish a new compiled ruleset
    Given a compiled draft ruleset version 8 exists for tenant "acme"
    When I publish version 8
    Then version 8 becomes the active ruleset for tenant "acme"
    And version 7 is retained as the previous active ruleset
    And all new authorization requests for "acme" are evaluated against version 8

  Scenario: Cannot publish an uncompiled draft
    Given a draft ruleset version 9 exists for tenant "acme" that has not been compiled
    When I attempt to publish version 9
    Then the publish is rejected
    And the active ruleset for tenant "acme" remains version 7
```

---

## Feature: Authorization evaluation

```gherkin
Feature: Authorization evaluation
  As the card network integration
  I want every authorization request evaluated against the active ruleset
  So that risky transactions are declined, locked, or warmed in real time

  Background:
    Given tenant "acme" has an active ruleset containing:
      | rule                                                       |
      | IF MCC in {5999, 4829} AND country != US THEN DECLINE      |
      | IF CVV failed AND card_not_present THEN LOCK               |
      | IF count(card, 10 min) > 5 THEN WARM                       |

  Scenario: Decline on MCC + non-US country
    When an authorization request arrives for tenant "acme" with:
      | field                | value |
      | MCC                  | 5999  |
      | country              | DE    |
      | CVV                  | ok    |
      | card_not_present     | false |
    Then the decision is "DECLINE"
    And the triggering rule is the MCC + country rule

  Scenario: Lock on failed CVV in a card-not-present transaction
    When an authorization request arrives for tenant "acme" with:
      | field                | value |
      | MCC                  | 5411  |
      | country              | US    |
      | CVV                  | failed|
      | card_not_present     | true  |
    Then the decision is "LOCK"
    And the triggering rule is the CVV + card-not-present rule

  Scenario: Warm on high-frequency card use
    Given the card has been used 6 times in the last 10 minutes
    When an authorization request arrives for tenant "acme" with:
      | field                | value |
      | MCC                  | 5411  |
      | country              | US    |
      | CVV                  | ok    |
      | card_not_present     | false |
    Then the decision is "WARM"
    And the triggering rule is the velocity rule

  Scenario: Approve when no rule matches
    When an authorization request arrives for tenant "acme" with:
      | field                | value |
      | MCC                  | 5411  |
      | country              | US    |
      | CVV                  | ok    |
      | card_not_present     | false |
    And the card has been used 1 time in the last 10 minutes
    Then the decision is "APPROVE"
    And no rule is reported as triggered
```

---

## Feature: 300 ms evaluation SLA

```gherkin
Feature: 300 ms evaluation SLA
  As the platform operator
  I want every authorization decision returned within 300 ms
  So that we never block the card network beyond its budget

  Scenario: Evaluation completes within budget
    Given tenant "acme" has an active compiled ruleset
    When an authorization request is evaluated
    Then a decision is returned in at most 300 ms server-side end-to-end

  Scenario: Evaluation does not exceed budget at p99 under load
    Given tenant "acme" has an active compiled ruleset
    And the system is receiving 1000 authorization requests per second for "acme"
    When I measure server-side evaluation latency over a 5 minute window
    Then the p99 latency is at most 300 ms

  Scenario: Evaluation timeout fails safe
    Given evaluation for an authorization request exceeds 300 ms
    When the SLA timer elapses
    Then evaluation is aborted
    And the platform returns the configured fail-safe decision
    And the incident is recorded for review
```

---

## Feature: Multi-tenant isolation

```gherkin
Feature: Multi-tenant isolation
  As a platform serving ~100 client tenants
  I want each tenant's rules and data isolated
  So that one client cannot read or affect another client's risk policy

  Scenario: Tenant only sees its own rules
    Given tenant "acme" has rules authored by its analysts
    And tenant "globex" has rules authored by its analysts
    When an analyst for tenant "acme" lists rules
    Then only "acme" rules are returned
    And no "globex" rules are returned

  Scenario: Authorization uses the requesting tenant's ruleset
    Given tenant "acme" has an active ruleset that DECLINES MCC 5999
    And tenant "globex" has an active ruleset that APPROVES MCC 5999
    When an authorization request for tenant "globex" with MCC 5999 is evaluated
    Then the decision is "APPROVE"

  Scenario: Publishing in one tenant does not change another tenant
    Given tenant "acme" has active ruleset version 7
    And tenant "globex" has active ruleset version 3
    When tenant "acme" publishes ruleset version 8
    Then tenant "acme" active ruleset is version 8
    And tenant "globex" active ruleset is still version 3
```

---

## Feature: Platform independence

```gherkin
Feature: Platform independence
  As the engineering org
  I want the engine to run on any mainstream cloud, OS, or runtime
  So that we are not locked to a single vendor

  Scenario: Engine runs in a generic container
    Given the engine packaged as an OCI container image
    When the image is run on a Linux host with only standard container runtime
    Then the engine starts
    And it accepts authorization requests
    And it returns decisions

  Scenario: Engine has no cloud-vendor-specific runtime dependencies
    When I inspect the engine's runtime dependencies
    Then none of them require a specific cloud provider's proprietary service
```

---

## Notes

- Field names (`MCC`, `country`, `CVV`, `card_not_present`, `card`) and
  functions (`count(field, window)`) used here mirror the examples in
  `REQUIREMENTS.md`. The full whitelist is an open question and will tighten
  these scenarios once confirmed with the client.
- `APPROVE` is treated as the implicit default when no rule matches; this
  should also be confirmed with the client.
- The fail-safe decision used on SLA timeout (see "300 ms evaluation SLA")
  is intentionally left configurable and not pinned to a specific value here.
