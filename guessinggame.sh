function compare {
    abs=$1
    while [ $abs -ne 3 ]
    do
        if [ $abs -gt 3 ]
        then
                echo "Your guess is too high."
                echo "Make another guess."
                read abs
        else
                echo "Your guess is too low."
                echo "Make another guess."
                read abs
        fi
    done
}

echo "How many files are in the current directory? Make a guess."
read response
echo "You Entered: $response"
abs=$response
compare $abs
echo "The guess is correct. Congratulations."                                                                                                               
