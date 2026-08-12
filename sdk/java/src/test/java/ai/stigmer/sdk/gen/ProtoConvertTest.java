package ai.stigmer.sdk.gen;

import com.google.protobuf.Struct;
import com.google.protobuf.Value;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Direct contract pins for {@link ProtoConvert} (stigmer/stigmer#448).
 *
 * <p>{@link InputConversionTest} pins the same contract through the
 * generated toProto() entry points (and is the red-first negative control
 * against the pre-fix generated code); this file pins the converter's own
 * edges: null handling, Number subtypes, nested arrays, empty containers,
 * and exact path composition.
 */
class ProtoConvertTest {

    private static final class Opaque {
    }

    @Test
    void mapToStruct_nullMap_returnsDefaultInstance() {
        assertEquals(Struct.getDefaultInstance(), ProtoConvert.mapToStruct(null, "cfg"));
    }

    @Test
    void objectToValue_numberSubtypes_allConvertAsDouble() {
        assertEquals(3.0, ProtoConvert.objectToValue(3L, "n").getNumberValue());
        assertEquals(2.5, ProtoConvert.objectToValue(2.5f, "n").getNumberValue());
        assertEquals(7.0, ProtoConvert.objectToValue((short) 7, "n").getNumberValue());
        assertEquals(1.0, ProtoConvert.objectToValue(java.math.BigDecimal.ONE, "n").getNumberValue());
    }

    @Test
    void objectToValue_null_convertsToNullValue() {
        assertEquals(Value.KindCase.NULL_VALUE, ProtoConvert.objectToValue(null, "v").getKindCase());
    }

    @Test
    void objectToValue_emptyArray_convertsToEmptyList() {
        Value v = ProtoConvert.objectToValue(new String[0], "v");
        assertEquals(Value.KindCase.LIST_VALUE, v.getKindCase());
        assertEquals(0, v.getListValue().getValuesCount());
    }

    @Test
    void objectToValue_arrayOfMaps_convertsElementsAsStructs() {
        Value v = ProtoConvert.objectToValue(
            new Object[] {java.util.Map.of("k", "v")}, "rows");
        assertEquals("v", v.getListValue().getValues(0)
            .getStructValue().getFieldsOrThrow("k").getStringValue());
    }

    @Test
    void objectToValue_pojoInsideArray_errorNamesElementIndex() {
        StigmerException e = assertThrows(StigmerException.class,
            () -> ProtoConvert.objectToValue(new Object[] {"ok", new Opaque()}, "items"));

        assertEquals(ErrorCode.INVALID_ARGUMENT, e.getCode());
        assertEquals(io.grpc.Status.Code.INVALID_ARGUMENT, e.getGrpcCode());
        assertTrue(e.getMessage().startsWith("items[1]: "),
            "message should locate the element, got: " + e.getMessage());
    }

    @Test
    void objectToValue_pojoInsideIterable_errorNamesElementIndex() {
        StigmerException e = assertThrows(StigmerException.class,
            () -> ProtoConvert.objectToValue(java.util.List.of(new Opaque()), "items"));

        assertTrue(e.getMessage().startsWith("items[0]: "));
    }

    @Test
    void mapToStruct_pojoValue_errorNamesKeyPath() {
        StigmerException e = assertThrows(StigmerException.class,
            () -> ProtoConvert.mapToStruct(java.util.Map.of("outer",
                java.util.Map.of("inner", new Opaque())), "cfg"));

        assertTrue(e.getMessage().startsWith("cfg[\"outer\"][\"inner\"]: "),
            "message should compose the nested key path, got: " + e.getMessage());
        assertTrue(e.getMessage().contains(Opaque.class.getName()));
    }

    @Test
    void mapToStruct_nullKey_throwsInvalidArgument() {
        java.util.Map<Object, Object> map = new java.util.HashMap<>();
        map.put(null, "x");

        StigmerException e = assertThrows(StigmerException.class,
            () -> ProtoConvert.mapToStruct(map, "cfg"));

        assertEquals(ErrorCode.INVALID_ARGUMENT, e.getCode());
        assertTrue(e.getMessage().contains("map key null"),
            "message should name the null key, got: " + e.getMessage());
    }

    @Test
    void mapToStruct_integerKey_throwsInvalidArgumentNamingKeyType() {
        java.util.Map<Object, Object> map = new java.util.HashMap<>();
        map.put(42, "x");

        StigmerException e = assertThrows(StigmerException.class,
            () -> ProtoConvert.mapToStruct(map, "cfg"));

        assertTrue(e.getMessage().contains("java.lang.Integer"),
            "message should name the key type, got: " + e.getMessage());
    }
}
