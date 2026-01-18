# Testing Best Practices

This skill provides comprehensive testing knowledge and standards for code review.

## Testing Pyramid

Follow the testing pyramid for balanced test coverage:

```
       /\
      /UI\          Few UI/E2E tests (slow, brittle)
     /----\
    /Integ.\        Some integration tests (medium speed)
   /--------\
  /Unit Tests\      Many unit tests (fast, focused)
 /------------\
```

### Distribution Guidelines
- **70%** Unit Tests - Fast, focused, test single units
- **20%** Integration Tests - Test component interactions
- **10%** E2E Tests - Test complete user workflows

## Unit Testing Principles

### 1. FIRST Principles
- **Fast**: Tests should run in milliseconds
- **Independent**: No dependencies between tests
- **Repeatable**: Same results every time
- **Self-validating**: Clear pass/fail, no manual verification
- **Timely**: Written alongside or before code (TDD)

### 2. Test Structure (Arrange-Act-Assert)
```
test("should calculate total with discount") {
  // Arrange: Set up test data
  const cart = new ShoppingCart();
  cart.addItem("Book", 20.00);
  
  // Act: Execute the behavior
  const total = cart.calculateTotal(0.10);
  
  // Assert: Verify the result
  expect(total).toBe(18.00);
}
```

### 3. Test Naming Conventions
Use descriptive names that explain what is being tested:

```
✅ GOOD:
- test_user_login_with_valid_credentials_succeeds()
- should_return_404_when_product_not_found()
- calculateTotal_withDiscount_returnsDiscountedPrice()

❌ BAD:
- test1()
- testLogin()
- testCalculate()
```

## What to Test

### Critical Areas
1. **Business Logic**: Core functionality and algorithms
2. **Edge Cases**: Boundary conditions, empty inputs, nulls
3. **Error Handling**: Exception paths, validation failures
4. **Integration Points**: APIs, databases, external services
5. **Security**: Authentication, authorization, input validation

### Test Coverage Goals
- **Statements**: Aim for 80%+ coverage
- **Branches**: Cover all conditional paths
- **Functions**: Test all public functions
- **Critical Paths**: 100% coverage for security/payment logic

## Test Types

### Unit Tests
Test individual functions/methods in isolation:

```python
def test_calculate_discount():
    # Test single unit of work
    result = calculate_discount(price=100, discount_pct=10)
    assert result == 90
```

**Best Practices:**
- Use mocks for external dependencies
- Test one thing per test
- Keep tests simple and readable
- Fast execution (< 100ms per test)

### Integration Tests
Test interactions between components:

```javascript
test("user registration creates account and sends email", async () => {
  const result = await registerUser(userData);
  
  expect(result.user).toBeDefined();
  expect(result.user.id).toBeTruthy();
  
  // Verify database record
  const dbUser = await db.users.findById(result.user.id);
  expect(dbUser.email).toBe(userData.email);
  
  // Verify email sent
  expect(emailService.sendEmail).toHaveBeenCalledWith(
    expect.objectContaining({ to: userData.email })
  );
});
```

**Best Practices:**
- Test real component interactions
- Use test databases (not production!)
- Clean up test data after each test
- Acceptable to be slower than unit tests

### E2E Tests
Test complete user workflows:

```javascript
test("user can complete checkout flow", async () => {
  await loginAsUser();
  await addItemToCart("Product A");
  await proceedToCheckout();
  await enterPaymentDetails(testCard);
  await confirmOrder();
  
  await expect(page).toHaveText("Order confirmed");
});
```

**Best Practices:**
- Test critical user journeys
- Keep number of E2E tests small (slow, expensive)
- Use realistic test data
- Run in isolated environments

## Mocking & Test Doubles

### Types of Test Doubles

**Dummy**: Objects passed around but never used
```javascript
const dummy = null; // Just to satisfy function signature
```

**Stub**: Provides canned responses
```javascript
const stub = {
  getUser: () => ({ id: 1, name: "Test User" })
};
```

**Mock**: Verifies interactions
```javascript
const mock = jest.fn();
service.sendEmail(mock);
expect(mock).toHaveBeenCalledWith("user@example.com");
```

**Fake**: Working implementation (simplified)
```javascript
class FakeDatabase {
  constructor() { this.data = {}; }
  save(key, value) { this.data[key] = value; }
  get(key) { return this.data[key]; }
}
```

### When to Mock
- External services (APIs, databases)
- Time-dependent code (dates, timers)
- Random number generators
- File system operations
- Network requests

## Test Quality Indicators

### ✅ Good Tests
- Clear purpose and intention
- Test behavior, not implementation
- Easy to understand and maintain
- Fast execution
- Reliable (no flaky tests)
- Good failure messages

### ❌ Bad Tests
- Overly complex test setup
- Testing implementation details
- Fragile (break on refactoring)
- Slow execution
- Flaky (random failures)
- Unclear failure messages

## Common Testing Patterns

### Test Data Builders
```javascript
class UserBuilder {
  constructor() {
    this.user = {
      name: "Test User",
      email: "test@example.com",
      age: 30
    };
  }
  
  withName(name) {
    this.user.name = name;
    return this;
  }
  
  withEmail(email) {
    this.user.email = email;
    return this;
  }
  
  build() {
    return this.user;
  }
}

// Usage
const user = new UserBuilder()
  .withName("John Doe")
  .withEmail("john@example.com")
  .build();
```

### Parameterized Tests
```python
@pytest.mark.parametrize("input,expected", [
    (100, 90),   # 10% discount
    (200, 180),  # 10% discount
    (50, 45),    # 10% discount
])
def test_discount_calculation(input, expected):
    result = calculate_discount(input, 0.10)
    assert result == expected
```

### Setup and Teardown
```javascript
describe("UserService", () => {
  let service;
  let database;
  
  beforeEach(() => {
    database = new TestDatabase();
    service = new UserService(database);
  });
  
  afterEach(() => {
    database.cleanup();
  });
  
  test("creates user", () => {
    // Test implementation
  });
});
```

## Code Review Testing Checklist

### Coverage
- [ ] New code has appropriate tests
- [ ] Edge cases are tested
- [ ] Error paths are tested
- [ ] Tests follow naming conventions

### Quality
- [ ] Tests are readable and maintainable
- [ ] Tests are independent (no shared state)
- [ ] Tests are fast (unit tests < 100ms)
- [ ] No flaky tests (random failures)

### Structure
- [ ] Tests follow Arrange-Act-Assert pattern
- [ ] Mocking is used appropriately
- [ ] Test data is clear and minimal
- [ ] Setup/teardown is clean

### Integration
- [ ] Integration tests cover component interactions
- [ ] E2E tests cover critical user flows
- [ ] Tests run in CI/CD pipeline
- [ ] Test failures are actionable

## Testing Anti-Patterns to Avoid

### The Liar
Test that passes but doesn't actually test anything:
```javascript
❌ test("saves user", () => {
  userService.save(user);
  expect(true).toBe(true); // Meaningless assertion
});
```

### The Giant
Test that tries to test everything:
```javascript
❌ test("entire user workflow", () => {
  // 200 lines of test code testing multiple features
});
```

### The Mockery
Over-mocking leads to tests that don't reflect reality:
```javascript
❌ test("processes payment", () => {
  // Everything is mocked, nothing real is tested
  jest.mock("./payment");
  jest.mock("./database");
  jest.mock("./email");
  // ... no actual logic is tested
});
```

### The Inspector
Test that knows too much about internal implementation:
```javascript
❌ test("user service", () => {
  expect(service.internalCache).toHaveLength(1); // Testing internals
});
```

### The Slow Poke
Test that takes too long (usually due to real DB, sleep, etc.):
```javascript
❌ test("async operation", async () => {
  await sleep(5000); // Never wait in tests!
  // ...
});
```

## Resources

- Test-Driven Development (TDD) by Kent Beck
- Working Effectively with Legacy Code by Michael Feathers
- xUnit Test Patterns by Gerard Meszaros
- Growing Object-Oriented Software, Guided by Tests
