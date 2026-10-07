package ai.stigmer.sdk.gen;

import com.google.protobuf.ListValue;
import com.google.protobuf.NullValue;
import com.google.protobuf.Struct;
import com.google.protobuf.Value;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Wire-shape pins for the generated Input struct/value conversion
 * (stigmer/stigmer#448).
 *
 * <p>Every test here calls only {@code toProto()} entry points, whose
 * signatures are identical before and after the #448 emitter fix — so this
 * file compiles against BOTH generations and serves as the red-first
 * negative control: against the pre-fix generated code the array cases
 * produce a garbage StringValue ({@code "[Ljava.lang.String;@..."}), the
 * unsupported-type cases return normally instead of throwing, and the
 * non-String-key case dies with a raw ClassCastException.
 *
 * <p>The struct-kind field these tests drive is an agent run's
 * {@code structuredOutputSchema}, converted through the real
 * {@code RunInput} entry point.
 */
class InputConversionTest {

    /** A value type the Struct conversion cannot represent faithfully. */
    private static final class Outcome {
        @Override
        public String toString() {
            return "Outcome{approved}";
        }
    }

    private enum Mode { FAST }

    private static Struct schemaOnTheWire(java.util.Map<String, Object> schema) {
        return RunInput.builder()
            .name("verdict-run")
            .org("acme")
            .sessionId("ses-1")
            .structuredOutputSchema(schema)
            .build()
            .toProto()
            .getSpec()
            .getStructuredOutputSchema();
    }

    // ------------------------------------------------------------------
    // Normalization: arrays become ListValue (they are not Iterable, so
    // the pre-fix code coerced them to String.valueOf garbage).
    // ------------------------------------------------------------------

    @Test
    void schema_stringArray_convertsToListValue() {
        Struct schema = schemaOnTheWire(java.util.Map.of("tags", new String[] {"a", "b"}));

        Value tags = schema.getFieldsOrThrow("tags");
        assertEquals(Value.KindCase.LIST_VALUE, tags.getKindCase());
        assertEquals(2, tags.getListValue().getValuesCount());
        assertEquals("a", tags.getListValue().getValues(0).getStringValue());
        assertEquals("b", tags.getListValue().getValues(1).getStringValue());
    }

    @Test
    void schema_primitiveIntArray_convertsToListValue() {
        Struct schema = schemaOnTheWire(java.util.Map.of("counts", new int[] {1, 2, 3}));

        Value counts = schema.getFieldsOrThrow("counts");
        assertEquals(Value.KindCase.LIST_VALUE, counts.getKindCase());
        assertEquals(3, counts.getListValue().getValuesCount());
        assertEquals(2.0, counts.getListValue().getValues(1).getNumberValue());
    }

    // ------------------------------------------------------------------
    // Refusal: unsupported types throw the SDK's structured error naming
    // the offending field path — never a silent toString on the wire.
    // ------------------------------------------------------------------

    @Test
    void schema_pojo_throwsInvalidArgumentNamingPath() {
        StigmerException e = assertThrows(StigmerException.class,
            () -> schemaOnTheWire(java.util.Map.of("outcome", new Outcome())));

        assertEquals(ErrorCode.INVALID_ARGUMENT, e.getCode());
        assertTrue(e.getMessage().contains("structuredOutputSchema[\"outcome\"]"),
            "message should name the field path, got: " + e.getMessage());
        assertTrue(e.getMessage().contains(Outcome.class.getName()),
            "message should name the offending type, got: " + e.getMessage());
    }

    @Test
    void schema_enum_throwsInvalidArgument() {
        StigmerException e = assertThrows(StigmerException.class,
            () -> schemaOnTheWire(java.util.Map.of("mode", Mode.FAST)));

        assertEquals(ErrorCode.INVALID_ARGUMENT, e.getCode());
        assertTrue(e.getMessage().contains("structuredOutputSchema[\"mode\"]"));
    }

    @Test
    void schema_instant_throwsInvalidArgument() {
        StigmerException e = assertThrows(StigmerException.class,
            () -> schemaOnTheWire(java.util.Map.of("at", java.time.Instant.EPOCH)));

        assertEquals(ErrorCode.INVALID_ARGUMENT, e.getCode());
        assertTrue(e.getMessage().contains("structuredOutputSchema[\"at\"]"));
    }

    @Test
    void schema_pojoDeepInsideListsAndMaps_errorNamesFullPath() {
        java.util.Map<String, Object> config = java.util.Map.of(
            "steps", java.util.List.of(java.util.Map.of("bad", new Outcome())));

        StigmerException e = assertThrows(StigmerException.class,
            () -> schemaOnTheWire(config));

        assertTrue(e.getMessage().contains("structuredOutputSchema[\"steps\"][0][\"bad\"]"),
            "message should compose the nested path, got: " + e.getMessage());
    }

    @Test
    void schema_nonStringMapKey_throwsInvalidArgumentNotClassCast() {
        java.util.Map<Object, Object> raw = new java.util.HashMap<>();
        raw.put(42, "x");
        @SuppressWarnings("unchecked") // what type erasure lets callers do
        java.util.Map<String, Object> smuggled = (java.util.Map<String, Object>) (java.util.Map<?, ?>) raw;

        StigmerException e = assertThrows(StigmerException.class,
            () -> schemaOnTheWire(java.util.Map.of("nested", smuggled)));

        assertEquals(ErrorCode.INVALID_ARGUMENT, e.getCode());
        assertTrue(e.getMessage().contains("structuredOutputSchema[\"nested\"]"));
        assertTrue(e.getMessage().contains("Integer"),
            "message should name the offending key type, got: " + e.getMessage());
    }

    // ------------------------------------------------------------------
    // Compatibility: every value that converted correctly before the fix
    // converts to the byte-identical Struct after it.
    // ------------------------------------------------------------------

    @Test
    void schema_recognizedValues_convertUnchanged() {
        java.util.Map<String, Object> nested = new java.util.HashMap<>();
        nested.put("inner", "v");
        java.util.Map<String, Object> config = new java.util.HashMap<>();
        config.put("str", "hello");
        config.put("num", 1.5);
        config.put("flag", true);
        config.put("none", null);
        config.put("obj", nested);
        config.put("list", java.util.List.of("x", 2));

        Struct got = schemaOnTheWire(config);

        Struct want = Struct.newBuilder()
            .putFields("str", Value.newBuilder().setStringValue("hello").build())
            .putFields("num", Value.newBuilder().setNumberValue(1.5).build())
            .putFields("flag", Value.newBuilder().setBoolValue(true).build())
            .putFields("none", Value.newBuilder().setNullValue(NullValue.NULL_VALUE).build())
            .putFields("obj", Value.newBuilder().setStructValue(Struct.newBuilder()
                .putFields("inner", Value.newBuilder().setStringValue("v").build())).build())
            .putFields("list", Value.newBuilder().setListValue(ListValue.newBuilder()
                .addValues(Value.newBuilder().setStringValue("x"))
                .addValues(Value.newBuilder().setNumberValue(2))).build())
            .build();
        assertEquals(want, got);
    }
}
