---
name: calculator
version: 1.0.0
description: Performs basic arithmetic operations
---

# Calculator Skill

A simple calculator skill for basic arithmetic operations.

## Tools

### calculator

Performs arithmetic operations on two numbers.

**Usage**:
```bash
./calculator.sh <operation> <num1> <num2>
```

**Operations**:
- `add` - Adds two numbers
- `subtract` - Subtracts second number from first
- `multiply` - Multiplies two numbers
- `divide` - Divides first number by second

**Arguments**:
- `operation` - One of: add, subtract, multiply, divide
- `num1` - First number (integer or decimal)
- `num2` - Second number (integer or decimal)

**Returns**: The calculated result as a number

**Examples**:
```bash
# Addition
./calculator.sh add 5 3
# Output: 8

# Subtraction
./calculator.sh subtract 10 3
# Output: 7

# Multiplication
./calculator.sh multiply 4 5
# Output: 20

# Division
./calculator.sh divide 15 3
# Output: 5
```

**Error Handling**:
- Division by zero returns error message
- Invalid operations return error message
- Non-numeric inputs return error message

## Notes

- Supports both integers and decimal numbers
- Maximum precision: 10 decimal places
- All operations are performed using floating-point arithmetic
