/*

Compiles all the test cases and runs them via webdriver to summarize the results


*/


import * as fs from 'fs';
import * as path from 'path';


export function generate(dir: string){
    fs.mkdirSync(path.join(dir, "V8"), {recursive: true})
    fs.mkdirSync(path.join(dir, "V8", "Benchmark", "Runner"), {recursive: true})

    fs.writeFileSync(path.join(dir, "V8", "Benchmark.elm"), main)
    fs.writeFileSync(path.join(dir, "V8", "Benchmark", "Runner", "Json.elm"), runner)
    fs.writeFileSync(path.join(dir, "V8", "Debug.elm"),debug)
}


const main = `port module V8.Benchmark exposing (main)

{-| -}


import V8.Benchmark.Runner.Json
import Suite
import Json.Encode
import V8.Debug

main : V8.Benchmark.Runner.Json.JsonBenchmark
main =
    V8.Benchmark.Runner.Json.program
        reportResults
        Suite.suite
        (V8.Debug.analyzeMemory [])

port reportResults : Json.Encode.Value -> Cmd msg
`

const runner = `module V8.Benchmark.Runner.Json exposing ( JsonBenchmark, program)

import Benchmark exposing (Benchmark)
import Benchmark.Reporting
import Benchmark.Status
import Browser
import Html exposing (Html)
import Html.Attributes as Attr
import Json.Encode as Encode
import Process
import Task exposing (Task)
import Trend.Linear as Trend exposing (Quick, Trend)
import V8.Debug

type alias JsonBenchmark =
    Program () Model Msg


{-| A benchmark runner which will send results out a port when done.
-}
program : (Encode.Value -> Cmd Msg) -> Benchmark -> V8.Debug.MemoryAnalyzer -> Program () Model Msg
program sendReport benchmark analyzeMemory =
    Browser.element
        { init = init benchmark
        , update = update sendReport analyzeMemory
        , view = view
        , subscriptions = \_ -> Sub.none
        }


type alias Model =
    Benchmark


init : Benchmark -> () -> ( Model, Cmd Msg )
init benchmark _ =
    ( benchmark, next benchmark )


type Msg
    = Update Benchmark

update : (Encode.Value -> Cmd Msg) ->  V8.Debug.MemoryAnalyzer ->  Msg -> Model -> ( Model, Cmd Msg )
update sendReport memory msg model =
    case msg of
        Update benchmark ->
            if Benchmark.done benchmark then
                let
                    _ = V8.Debug.enableMemoryChecks ()
                    _ =
                        V8.Debug.runMemory memory

                in
                ( benchmark
                , sendReport
                    (Encode.object
                        [ ("benchmarks", (encode benchmark))
                        , ("v8", V8.Debug.reportV8StatusForBenchmarks ())
                        ]
                    )
                )

            else
                ( benchmark
                , next benchmark
                )


breakForRender : Task x a -> Task x a
breakForRender task =
    Task.andThen (\_ -> task) (Process.sleep 0)


next : Benchmark -> Cmd Msg
next benchmark =
    if Benchmark.done benchmark then
        Cmd.none

    else
        Benchmark.step benchmark
            |> breakForRender
            |> Task.perform (Update)



-- VIEW


view : Model -> Html Msg
view model =
    Html.div [ Attr.style "white-space" "pre" ]
        [ Html.text
            (Encode.encode 4 (encode model))

        , Html.text
            (Encode.encode 4 (V8.Debug.reportV8StatusForBenchmarks ()))
        ]



-- ENCODE RESULTS


encode : Benchmark -> Encode.Value
encode benchmark =
    encodeReport (Benchmark.Reporting.fromBenchmark benchmark)


encodeReport : Benchmark.Reporting.Report -> Encode.Value
encodeReport report =
    report
        |> flattenReport
        |> Encode.list encodeResultItem


type alias Item =
    { name : String
    , tags : List String
    , status : Benchmark.Status.Status
    }


flattenReport : Benchmark.Reporting.Report -> List Item
flattenReport report =
    case report of
        Benchmark.Reporting.Single name status ->
            [ { name = name
              , tags = []
              , status = status
              }
            ]

        Benchmark.Reporting.Series name statuses ->
            List.map
                (\( tag, status ) ->
                    { name = name
                    , tags = [ tag ]
                    , status = status
                    }
                )
                statuses

        Benchmark.Reporting.Group name reports ->
            List.concatMap (flattenReportGroup [ name ]) reports


flattenReportGroup : List String -> Benchmark.Reporting.Report -> List Item
flattenReportGroup groups report =
    case report of
        Benchmark.Reporting.Single name status ->
            [ { name = name
              , tags = groups
              , status = status
              }
            ]

        Benchmark.Reporting.Series name statuses ->
            List.map
                (\( tag, status ) ->
                    { name = name
                    , tags = groups ++ [ tag ]
                    , status = status
                    }
                )
                statuses

        Benchmark.Reporting.Group name reports ->
            List.concatMap (flattenReportGroup (groups ++ [ name ])) reports


encodeResultItem : Item -> Encode.Value
encodeResultItem item =
    Encode.object
        [ ( "name", Encode.string item.name )
        , ( "tags", Encode.list Encode.string item.tags )
        , ( "status", encodeStatus item.status )
        ]


encodeStatus : Benchmark.Status.Status -> Encode.Value
encodeStatus status =
    case status of
        Benchmark.Status.Cold ->
            Encode.object
                [ ( "status", Encode.string "cold" ) ]

        Benchmark.Status.Unsized ->
            Encode.object
                [ ( "status", Encode.string "unsized" ) ]

        Benchmark.Status.Pending i samples ->
            Encode.object
                [ ( "status", Encode.string "pending" )
                , ( "progress", Encode.float (Benchmark.Status.progress status) )
                ]

        Benchmark.Status.Failure error ->
            Encode.object
                [ ( "status", Encode.string "failure" ) ]

        Benchmark.Status.Success samples quickTrend ->
            Encode.object
                [ ( "status", Encode.string "success" )
                , ( "runsPerSecond", Encode.int (runsPerSecond quickTrend) )
                , ( "goodnessOfFit", Encode.float (Trend.goodnessOfFit quickTrend) )
                ]


runsPerSecond : Trend Quick -> Int
runsPerSecond =
    Trend.line
        >> (\a -> Trend.predictX a 1000)
        >> floor

`

const debug = `module V8.Debug exposing (runMemory,enableMemoryChecks, MemoryAnalyzer, analyzeMemory, memory, optimizationStatus, reportV8StatusForBenchmarks)

{-| -}

import Json.Encode



type MemoryAnalyzer =
    Memory (List (() -> ()))

analyzeMemory : List (() -> ()) -> MemoryAnalyzer
analyzeMemory =
    Memory

runMemory : MemoryAnalyzer -> ()
runMemory (Memory fns) =
    let
        _ = List.map (\fn -> fn ()) fns
    in
    ()


enableMemoryChecks : () -> ()
enableMemoryChecks _ =
    ()


memory : String -> a -> a
memory tag v =
    v


type Status
    = Status Int


optimizationStatus : String -> a -> a
optimizationStatus tag value =
    value


{-|

    hasFastProperties obj

    hasFastSmiElements obj

    hasFastObjectElements obj

    hasFastDoubleElements obj

    hasDictionaryElements obj

    hasFastHoleyElements obj

    haveSameMap ( obj1, obj2 )

    isValidSmi obj

    isSmi obj

    hasFastSmiOrObjectElements obj

    hasSloppyArgumentsElements obj

-}
type alias MemoryProperties =
    { tag : String
    , hasFastProperties : Bool
    , hasFastSmiElements : Bool
    , hasFastObjectElements : Bool
    , hasFastDoubleElements : Bool
    , hasDictionaryElements : Bool
    , hasFastHoleyElements : Bool
    , isValidSmi : Bool
    , isSmi : Bool
    , hasFastSmiOrObjectElements : Bool
    , hasSloppyArgumentsElements : Bool
    }


reportV8StatusForBenchmarks : () -> Json.Encode.Value
reportV8StatusForBenchmarks _ =
    Json.Encode.null

`