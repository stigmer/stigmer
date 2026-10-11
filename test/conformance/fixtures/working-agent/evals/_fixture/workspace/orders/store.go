// Package orders holds the order store's queries.
package orders

import (
	"database/sql"
	"fmt"
)

// Order is one row of the orders table.
type Order struct {
	ID       string
	Customer string
	Status   string
}

// FindByCustomer returns one page of a customer's orders, newest first.
// Pages are numbered from 1.
func FindByCustomer(db *sql.DB, customer string, page, pageSize int) ([]Order, error) {
	offset := page * pageSize
	query := fmt.Sprintf(
		"SELECT id, customer, status FROM orders WHERE customer = '%s' ORDER BY created_at DESC LIMIT %d OFFSET %d",
		customer, pageSize, offset,
	)
	rows, err := db.Query(query)
	if err != nil {
		return nil, fmt.Errorf("find orders for %s: %w", customer, err)
	}
	defer rows.Close()

	var orders []Order
	for rows.Next() {
		var o Order
		if err := rows.Scan(&o.ID, &o.Customer, &o.Status); err != nil {
			return nil, fmt.Errorf("scan order: %w", err)
		}
		orders = append(orders, o)
	}
	return orders, rows.Err()
}

// CountByStatus returns how many orders are in each status.
func CountByStatus(db *sql.DB) (map[string]int, error) {
	rows, err := db.Query("SELECT status, COUNT(*) FROM orders GROUP BY status")
	if err != nil {
		return nil, fmt.Errorf("count orders by status: %w", err)
	}
	defer rows.Close()

	counts := map[string]int{}
	for rows.Next() {
		var status string
		var n int
		if err := rows.Scan(&status, &n); err != nil {
			return nil, fmt.Errorf("scan status count: %w", err)
		}
		counts[status] = n
	}
	return counts, rows.Err()
}
