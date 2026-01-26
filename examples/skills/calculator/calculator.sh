#!/bin/bash
# Calculator skill - performs basic arithmetic operations

set -e

if [ $# -ne 3 ]; then
    echo "Error: Expected 3 arguments (operation, num1, num2)" >&2
    echo "Usage: $0 <operation> <num1> <num2>" >&2
    exit 1
fi

operation=$1
num1=$2
num2=$3

# Validate numbers
if ! [[ "$num1" =~ ^-?[0-9]+\.?[0-9]*$ ]]; then
    echo "Error: '$num1' is not a valid number" >&2
    exit 1
fi

if ! [[ "$num2" =~ ^-?[0-9]+\.?[0-9]*$ ]]; then
    echo "Error: '$num2' is not a valid number" >&2
    exit 1
fi

case "$operation" in
    add)
        result=$(echo "$num1 + $num2" | bc -l)
        ;;
    subtract)
        result=$(echo "$num1 - $num2" | bc -l)
        ;;
    multiply)
        result=$(echo "$num1 * $num2" | bc -l)
        ;;
    divide)
        if [ "$num2" = "0" ] || [ "$num2" = "0.0" ]; then
            echo "Error: Division by zero" >&2
            exit 1
        fi
        result=$(echo "scale=10; $num1 / $num2" | bc -l)
        ;;
    *)
        echo "Error: Unknown operation '$operation'" >&2
        echo "Valid operations: add, subtract, multiply, divide" >&2
        exit 1
        ;;
esac

echo "$result"
